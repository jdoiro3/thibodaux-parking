import React, { useState, useMemo } from 'react';
import { Polygon, InfoWindow } from '@vis.gl/react-google-maps';
import { areaAcres } from './utils'; 
import { polygon as turfPolygon } from "@turf/helpers";
import { union } from "@turf/union";
import { featureCollection } from "@turf/helpers";


function HoverablePolygon({ polygon, onHoverChange }) {
    const [isHovered, setIsHovered] = useState(true);
    const [hoverPosition, setHoverPosition] = useState(null);

    // Calculate the acreage once for this polygon to show in the label
    const acres = useMemo(() => areaAcres(polygon.paths), [polygon.paths]);

    return (
        <>
            <Polygon
                paths={polygon.paths}
                fillColor="#facc15"
                fillOpacity={0.25}
                strokeColor="#facc15"
                strokeOpacity={1}
                strokeWeight={2}
                clickable
                onMouseOver={(e) => {
                    setIsHovered(true);
                    // e.latLng is a Google LatLng object; call toJSON() safely if available
                    const latLng = e.latLng ? e.latLng.toJSON() : null;
                    setHoverPosition(latLng);
                    onHoverChange(acres);

                }}
                onMouseOut={() => {
                    setIsHovered(false);
                    setHoverPosition(null);
                    onHoverChange(0);
                }}
            />

            {isHovered && hoverPosition && (
                <InfoWindow
                    position={hoverPosition}
                    headerDisabled={true}
                    disableAutoPan={true}
                >
                    <div style={{
                        fontFamily: 'system-ui, sans-serif',
                        fontSize: '13px',
                        padding: '4px 6px',
                        color: '#333'
                    }}>
                        <strong>{polygon.name || "Parking Lot"}</strong>
                        <div style={{ marginTop: '2px', color: '#666' }}>
                            {/* Displaying the calculated value inside the label */}
                            Size: {acres.toFixed(2)} acres
                            <br></br>
                            Id: {polygon.properties.id}
                        </div>
                    </div>
                </InfoWindow>
            )}
        </>
    );
}


export function ParkingLayer({ polygons, onHoverChange }) {
    return (
        <>
            {polygons.map((polygon, index) => (
                <HoverablePolygon
                    key={polygon.id || index}
                    polygon={polygon}
                    onHoverChange={onHoverChange}
                />
            ))}
        </>
    );
}


export function parkingPolygonToTurf(parkingPolygon) {
    if (!parkingPolygon?.paths?.length) {
        return null;
    }

    /*
     * paths[0] = outer ring
     * paths[1+] = holes
     */
    const rings = parkingPolygon.paths.map((ring) => {
        const coordinates = ring.map(({ lng, lat }) => [
            lng,
            lat,
        ]);

        /*
         * Turf requires closed rings.
         */
        if (coordinates.length > 0) {
            const first = coordinates[0];
            const last = coordinates[coordinates.length - 1];

            if (
                first[0] !== last[0] ||
                first[1] !== last[1]
            ) {
                coordinates.push([...first]);
            }
        }

        return coordinates;
    });

    if (!rings[0] || rings[0].length < 4) {
        return null;
    }

    try {
        return turfPolygon(rings);
    } catch (error) {
        console.warn(
            "Unable to convert parking polygon to Turf:",
            error
        );

        return null;
    }
}


export function googlePathsToTurfPolygon(paths) {
    if (!paths || !paths.length) return null;

    const coordinates = paths.map((ring) =>
        ring.map((point) => [Number(point.lng), Number(point.lat)])
    );

    for (const ring of coordinates) {
        if (ring.length < 3) continue;
        const first = ring[0];
        const last = ring[ring.length - 1];

        if (first[0] !== last[0] || first[1] !== last[1]) {
            ring.push([...first]);
        }
    }

    if (coordinates[0]?.length < 4) return null;

    return {
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates },
    };
}


export function combineCityLimitPolygons(cityLimitPolygons) {
    const turfPolygons = cityLimitPolygons
        .map((polygon) => googlePathsToTurfPolygon(polygon.paths))
        .filter(Boolean);

    if (!turfPolygons.length) return null;

    let combined = turfPolygons[0];

    for (let i = 1; i < turfPolygons.length; i++) {
        try {
            const result = union(
                featureCollection([combined, turfPolygons[i]])
            );

            if (result) combined = result;
        } catch (error) {
            console.warn("Unable to combine city-limit polygons:", error);
        }
    }

    return combined;
}


export function combineCommercialPolygons(commercialPolygons) {
    if (!commercialPolygons.length) {
        return null;
    }

    const turfPolygons = commercialPolygons
        .map((polygon) => {
            const coordinates = polygon.paths.map((ring) =>
                ring.map(({ lng, lat }) => [lng, lat])
            );

            return {
                type: "Feature",
                properties: {},
                geometry: {
                    type: "Polygon",
                    coordinates,
                },
            };
        });

    let combined = turfPolygons[0];

    for (let i = 1; i < turfPolygons.length; i++) {
        try {
            const result = union(
                featureCollection([
                    combined,
                    turfPolygons[i],
                ])
            );

            if (result) {
                combined = result;
            }
        } catch (error) {
            console.warn(
                "Unable to union commercial zone polygons:",
                error
            );
        }
    }

    return combined;
}


/* ============================================================
   GEOJSON → GOOGLE MAPS POLYGONS
   ============================================================ */

export function normalizeRing(ring) {
    return ring.map(([lng, lat]) => ({
        lat,
        lng,
    }));
}


export function extractPolygons(geojson) {
    const polygons = [];

    const addGeometry = (geometry, properties = {}) => {
        if (!geometry) return;

        if (geometry.type === "Polygon") {
            const rings = geometry.coordinates || [];

            if (rings.length && rings[0].length >= 3) {
                polygons.push({
                    paths: rings.map(normalizeRing),
                    properties,
                    geometryType: "Polygon",
                });
            }
        }

        /*
         * MultiPolygon
         *
         * Each polygon can contain an outer ring
         * and zero or more holes.
         */
        if (geometry.type === "MultiPolygon") {
            for (const polygon of geometry.coordinates || []) {
                if (polygon?.[0]?.length >= 3) {
                    polygons.push({
                        paths: polygon.map(normalizeRing),
                        properties,
                        geometryType: "Polygon",
                    });
                }
            }
        }
    };

    if (geojson.type === "FeatureCollection") {
        for (const feature of geojson.features || []) {
            addGeometry(
                feature.geometry,
                feature.properties || {}
            );
        }
    } else if (geojson.type === "Feature") {
        addGeometry(
            geojson.geometry,
            geojson.properties || {}
        );
    } else {
        addGeometry(geojson, {});
    }

    return polygons;
}

export function combineParkingPolygons(parkingPolygons) {
    const turfPolygons = [];

    for (const parkingPolygon of parkingPolygons) {
        const turfFeature =
            parkingPolygonToTurf(parkingPolygon);

        if (turfFeature) {
            turfPolygons.push(turfFeature);
        }
    }

    if (!turfPolygons.length) {
        return null;
    }

    /*
     * Start with the first polygon and union the rest.
     *
     * This prevents overlapping parking polygons from
     * being counted twice.
     */
    let combined = turfPolygons[0];

    for (let i = 1; i < turfPolygons.length; i++) {
        try {
            const result = union(
                featureCollection([
                    combined,
                    turfPolygons[i],
                ])
            );

            if (result) {
                combined = result;
            }
        } catch (error) {
            console.warn(
                "Unable to union parking polygons:",
                error
            );
        }
    }

    return combined;
}