import { useEffect, useMemo, useState } from "react";
import {
    APIProvider,
    Map,
    Polygon,
    useMap,
    MapControl,
    ControlPosition,
} from "@vis.gl/react-google-maps";
import DrawingControls from './drawing-controls';
import GeoJsonControls from './geojson-controls';
import TerraDrawLayer from './terra-draw-layer';
import "./terra-draw.css";
import { ParkingLayer } from './polygons'; 
import { areaAcres } from './utils';

const THIBODAUX = { lat: 29.7958, lng: -90.8195 };
const GEOJSON_URL = "/data/thib-parking-lots.geojson";

function normalizeRing(ring) {
    return ring.map(([lng, lat]) => ({ lat, lng }));
}

function extractPolygons(geojson) {
    const polygons = [];

    const addGeometry = (geometry, properties = {}) => {
        if (!geometry) return;

        if (geometry.type === "Polygon") {
            const rings = geometry.coordinates || [];
            if (rings.length && rings[0].length >= 3) {
                polygons.push({
                    paths: rings.map(normalizeRing),
                    properties,
                });
            }
        }

        if (geometry.type === "MultiPolygon") {
            for (const polygon of geometry.coordinates || []) {
                if (polygon?.[0]?.length >= 3) {
                    polygons.push({
                        paths: polygon.map(normalizeRing),
                        properties,
                    });
                }
            }
        }
    };

    if (geojson.type === "FeatureCollection") {
        for (const feature of geojson.features || []) {
            addGeometry(feature.geometry, feature.properties || {});
        }
    } else if (geojson.type === "Feature") {
        addGeometry(geojson.geometry, geojson.properties || {});
    } else {
        addGeometry(geojson, {});
    }

    return polygons;
}

function centerOfPath(path) {
    if (!path?.length) return THIBODAUX;

    const total = path.reduce(
        (acc, p) => ({
            lat: acc.lat + p.lat,
            lng: acc.lng + p.lng,
        }),
        { lat: 0, lng: 0 }
    );

    return {
        lat: total.lat / path.length,
        lng: total.lng / path.length,
    };
}

function ParkingLayer2({ polygons, onHover }) {
    return (
        <>
            {polygons.map((polygon, index) => (
                <Polygon
                    key={`parking-${index}`}
                    paths={polygon.paths}
                    fillColor="#facc15"
                    fillOpacity={0.25}
                    strokeColor="#facc15"
                    strokeOpacity={1}
                    strokeWeight={2}
                    clickable
                />
            ))}
        </>
    );
}

function AppContent() {
    const [geoJsonLoaded, setGeoJsonLoaded] = useState(false);
    const [polygons, setPolygons] = useState([]);

    useEffect(() => {
        let cancelled = false;

        fetch(GEOJSON_URL)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`GeoJSON request failed: ${response.status}`);
                }
                return response.json();
            })
            .then((geojson) => {
                if (cancelled) return;
                setPolygons(extractPolygons(geojson));
                setGeoJsonLoaded(true);
            })
            .catch((error) => {
                console.error("Unable to load parking GeoJSON:", error);
                if (!cancelled) setGeoJsonLoaded(false);
            });

        return () => {
            cancelled = true;
        };
    }, []);

    const totalParkingAcres = useMemo(() => {
        if (!geoJsonLoaded || !polygons.length) return 0;

        return polygons.reduce((total, polygon) => {
            return total + areaAcres(polygon.paths);
        }, 0);
    }, [polygons, geoJsonLoaded]);

    const [hoveredArea, setHoveredArea] = useState(0);

    return (
        <Map
            id="thibodaux-map"
            defaultCenter={THIBODAUX}
            defaultZoom={14.5}
            mapTypeId="satellite"
            gestureHandling="greedy"
            disableDefaultUI={false}
            streetViewControl={false}
            fullscreenControl={true}
            mapTypeControl={true}
            zoomControl={true}
            rotateControl={true}
            scaleControl={true}
            style={{ height: "100vh" }}
        >
            <TerraDrawLayer>
                {(draw) => (
                    <MapControl position={ControlPosition.TOP_LEFT}>
                        <div className="terra-draw-toolbar">
                            <DrawingControls draw={draw} />
                            <GeoJsonControls draw={draw} />
                        </div>
                    </MapControl>
                )}
            </TerraDrawLayer>
            <ParkingLayer
                polygons={polygons}
                onHoverChange={(acres) => setHoveredArea(acres)} 
            />
        </Map>
    )
}


export default function App() {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
        return (
            <div
                style={{
                    padding: 24,
                    fontFamily: "system-ui, sans-serif",
                }}
            >
                <h2>Google Maps API key missing</h2>
                <p>
                    Add <code>VITE_GOOGLE_MAPS_API_KEY</code> to your Vite{" "}
                    <code>.env</code> file and restart the development server.
                </p>
            </div>
        );
    }

    return (
        <APIProvider
            apiKey={apiKey}
            libraries={["geometry"]}
            version="weekly"
        >
            <AppContent />
        </APIProvider>
    );
}