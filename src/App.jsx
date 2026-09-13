import { useEffect, useMemo, useState } from "react";
import {
    APIProvider,
    Map,
    MapControl,
    ControlPosition,
    Polyline,
    AdvancedMarker,
    Polygon
} from "@vis.gl/react-google-maps";

import DrawingControls from "./drawing-controls";
import GeoJsonControls from "./geojson-controls";
import TerraDrawLayer from "./terra-draw-layer";
import "./terra-draw.css";

import { ParkingLayer, parkingPolygonToTurf } from "./polygons";
import { areaAcres } from "./utils";
import { TerraDrawWalkingDistance } from './walking-distance'

import turfArea from "@turf/area";
import { featureCollection } from "@turf/helpers";
import { intersect } from "@turf/intersect";
import { union } from "@turf/union";

const THIBODAUX = { lat: 29.7958, lng: -90.8195 };
const GEOJSON_URL = `${import.meta.env.BASE_URL}data/thib-parking-lots.geojson`;
const CITY_LIMITS_URL = `${import.meta.env.BASE_URL}data/thib-city-limits.geojson`;

const SQ_METERS_PER_ACRE = 4046.8564224;


/* ============================================================
   GEOJSON → GOOGLE MAPS POLYGONS
   ============================================================ */

function normalizeRing(ring) {
    return ring.map(([lng, lat]) => ({
        lat,
        lng,
    }));
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


/* ============================================================
   COMBINE PARKING POLYGONS
   ============================================================ */

function combineParkingPolygons(parkingPolygons) {
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


/* ============================================================
   TERRA DRAW ANALYSIS
   ============================================================ */

function TerraDrawAnalysis({
    draw,
    parkingPolygons,
    onAnalysis,
    analysisEnabled
}) {
    useEffect(() => {
        if (!analysisEnabled) {
            onAnalysis(null);
            return;
        }

        if (!draw) return;

        let calculating = false;

        const resetAnalysis = () => {
            onAnalysis({
                drawnAcres: 0,
                parkingAcres: 0,
                parkingPercent: 0,
                hasSelection: false,
            });
        };

        const calculateAnalysis = () => {
            /*
             * Prevent recursive/repeated calculations.
             */
            if (calculating) return;

            calculating = true;

            try {
                const snapshot = draw.getSnapshot();

                /*
                 * Find all Polygon/MultiPolygon features
                 * currently drawn with TerraDraw.
                 */
                const drawnFeatures = snapshot.filter(
                    (feature) =>
                        feature?.geometry?.type ===
                        "Polygon" ||
                        feature?.geometry?.type ===
                        "MultiPolygon"
                );

                if (!drawnFeatures.length) {
                    resetAnalysis();
                    return;
                }

                /*
                 * If multiple shapes have been drawn,
                 * combine them into one analysis area.
                 */
                let selection = drawnFeatures[0];

                for (
                    let i = 1;
                    i < drawnFeatures.length;
                    i++
                ) {
                    try {
                        const combined = union(
                            featureCollection([
                                selection,
                                drawnFeatures[i],
                            ])
                        );

                        if (combined) {
                            selection = combined;
                        }
                    } catch (error) {
                        console.warn(
                            "Unable to combine TerraDraw shapes:",
                            error
                        );
                    }
                }

                /*
                 * Calculate total selected area.
                 */
                const drawnSquareMeters = turfArea(selection);

                const drawnAcres =
                    drawnSquareMeters /
                    SQ_METERS_PER_ACRE;

                if (drawnAcres <= 0) {
                    resetAnalysis();
                    return;
                }

                /*
                 * Combine all parking polygons first.
                 *
                 * This is important because overlapping
                 * parking polygons should not be counted
                 * twice.
                 */
                const combinedParking =
                    combineParkingPolygons(
                        parkingPolygons
                    );

                if (!combinedParking) {
                    onAnalysis({
                        drawnAcres,
                        parkingAcres: 0,
                        parkingPercent: 0,
                        hasSelection: true,
                    });

                    return;
                }

                /*
                 * Find the portion of the parking polygons
                 * that falls inside the TerraDraw selection.
                 *
                 * New Turf versions expect a FeatureCollection
                 * here rather than two separate arguments.
                 */
                let parkingInside = null;

                try {
                    parkingInside = intersect(
                        featureCollection([
                            selection,
                            combinedParking,
                        ])
                    );
                } catch (error) {
                    console.warn(
                        "Unable to intersect selection with parking:",
                        error
                    );
                }

                const parkingSquareMeters =
                    parkingInside
                        ? turfArea(parkingInside)
                        : 0;

                const parkingAcres =
                    parkingSquareMeters /
                    SQ_METERS_PER_ACRE;

                /*
                 * Parking percentage of the selected area.
                 */
                const parkingPercent =
                    drawnSquareMeters > 0
                        ? (parkingSquareMeters /
                            drawnSquareMeters) *
                        100
                        : 0;

                onAnalysis({
                    drawnAcres,
                    parkingAcres,
                    parkingPercent,
                    hasSelection: true,
                });
            } finally {
                calculating = false;
            }
        };

        /*
         * TerraDraw fires change while a shape is
         * being edited and after features are changed.
         */
        const handleChange = () => {
            calculateAnalysis();
        };

        /*
         * finish is useful for completed drawings.
         */
        const handleFinish = () => {
            calculateAnalysis();
        };

        /*
         * Calculate when the component initializes.
         */
        calculateAnalysis();

        /*
         * Listen for TerraDraw updates.
         */
        draw.on("finish", handleFinish);

        return () => {
            draw.off("change", handleChange);
            draw.off("finish", handleFinish);
        };
    }, [
        draw,
        parkingPolygons,
        analysisEnabled,
        onAnalysis
    ]);

    return null;
}


/* ============================================================
   METRIC CARD
   ============================================================ */

function AnalysisCard({
    totalParkingAcres,
    totalCityAcres,
    cityParkingPercent,
    polygonCount,
    analysis,
    walkingDistance,
}) {
    return (
        <div
            style={{
                margin: "10px",
                padding: "14px 18px",
                background: "white",
                borderRadius: "8px",
                boxShadow:
                    "0 2px 6px rgba(0,0,0,0.25)",
                fontFamily:
                    "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
                minWidth: "205px",
            }}
        >
            {/* ============================================
                CITYWIDE PARKING TOTAL
                ============================================ */}

            <div>
                <div
                    style={{
                        fontSize: "11px",
                        color: "#666",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: "4px",
                    }}
                >
                    Total Parking Area
                </div>

                <div
                    style={{
                        fontSize: "26px",
                        fontWeight: "700",
                        lineHeight: "1.1",
                    }}
                >
                    {totalParkingAcres.toFixed(1)}
                </div>

                <div
                    style={{
                        fontSize: "12px",
                        color: "#666",
                    }}
                >
                    acres
                </div>

                <div
                    style={{
                        fontSize: "11px",
                        color: "#888",
                        marginTop: "4px",
                    }}
                >
                    {polygonCount.toLocaleString()} polygons
                </div>
            </div>

            <div
                style={{
                    marginTop: "12px",
                    paddingTop: "10px",
                    borderTop: "1px solid #ddd",
                }}
            >
                <div
                    style={{
                        fontSize: "11px",
                        color: "#666",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: "4px",
                    }}
                >
                    City Area
                </div>

                <div
                    style={{
                        fontSize: "20px",
                        fontWeight: "700",
                        lineHeight: "1.1",
                    }}
                >
                    {totalCityAcres.toFixed(1)}
                </div>

                <div
                    style={{
                        fontSize: "12px",
                        color: "#666",
                    }}
                >
                    acres
                </div>

                <div
                    style={{
                        marginTop: "8px",
                        fontSize: "18px",
                        fontWeight: "700",
                    }}
                >
                    {cityParkingPercent.toFixed(1)}%
                </div>

                <div
                    style={{
                        fontSize: "11px",
                        color: "#666",
                    }}
                >
                    of city area is off-street parking
                </div>
            </div>


            {/* ============================================
                TERRA DRAW AREA ANALYSIS
                ============================================ */}

            {analysis?.hasSelection && (
                <div
                    style={{
                        marginTop: "14px",
                        paddingTop: "12px",
                        borderTop: "1px solid #ddd",
                    }}
                >
                    <div
                        style={{
                            fontSize: "11px",
                            color: "#666",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: "4px",
                        }}
                    >
                        Selected Area
                    </div>

                    <div
                        style={{
                            fontSize: "22px",
                            fontWeight: "700",
                            lineHeight: "1.1",
                        }}
                    >
                        {analysis.drawnAcres.toFixed(2)}
                    </div>

                    <div
                        style={{
                            fontSize: "12px",
                            color: "#666",
                        }}
                    >
                        acres
                    </div>


                    {/* Parking acreage inside selection */}

                    <div
                        style={{
                            marginTop: "10px",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "11px",
                                color: "#666",
                                textTransform: "uppercase",
                            }}
                        >
                            Parking Inside
                        </div>

                        <div
                            style={{
                                fontSize: "19px",
                                fontWeight: "700",
                            }}
                        >
                            {analysis.parkingAcres.toFixed(
                                2
                            )}{" "}
                            acres
                        </div>
                    </div>


                    {/* Parking percentage */}

                    <div
                        style={{
                            marginTop: "8px",
                            fontSize: "18px",
                            fontWeight: "700",
                        }}
                    >
                        {analysis.parkingPercent.toFixed(
                            1
                        )}
                        %
                    </div>

                    <div
                        style={{
                            fontSize: "11px",
                            color: "#666",
                        }}
                    >
                        of selected area is parking
                    </div>
                </div>
            )}


            {/* ============================================
                WALKING DISTANCE
                ============================================ */}

            {walkingDistance?.hasRoute && (
                <div
                    style={{
                        marginTop: "14px",
                        paddingTop: "12px",
                        borderTop: "1px solid #ddd",
                    }}
                >
                    <div
                        style={{
                            fontSize: "11px",
                            color: "#666",
                            textTransform: "uppercase",
                            letterSpacing: "0.05em",
                            marginBottom: "4px",
                        }}
                    >
                        Walking Distance
                    </div>

                    <div
                        style={{
                            fontSize: "22px",
                            fontWeight: "700",
                            lineHeight: "1.1",
                        }}
                    >
                        {(
                            walkingDistance.distanceMeters /
                            1609.344
                        ).toFixed(2)}
                    </div>

                    <div
                        style={{
                            fontSize: "12px",
                            color: "#666",
                        }}
                    >
                        miles
                    </div>

                    <div
                        style={{
                            fontSize: "16px",
                            fontWeight: "600",
                            marginTop: "6px",
                        }}
                    >
                        {Math.ceil(
                            walkingDistance.durationSeconds /
                            60
                        )}{" "}
                        min walk
                    </div>
                </div>
            )}
        </div>
    );
}


/* ============================================================
   MAIN MAP CONTENT
   ============================================================ */

function AppContent() {
    const [geoJsonLoaded, setGeoJsonLoaded] = useState(false);
    const [polygons, setPolygons] = useState([]);
    const handleGeoJsonImport = (geojson) => {
        const importedPolygons = extractPolygons(geojson);
        setPolygons(importedPolygons);
    };
    const [analysisEnabled, setAnalysisEnabled] = useState(false);
    const [hoveredArea, setHoveredArea] = useState(0);
    const [cityLimits, setCityLimits] = useState([]);
    const [cityLimitsLoaded, setCityLimitsLoaded] = useState(false);

    const [drawAnalysis, setDrawAnalysis] = useState({
        drawnAcres: 0,
        parkingAcres: 0,
        parkingPercent: 0,
        hasSelection: false,
    });

    const [walkingDistance, setWalkingDistance] = useState({
        distanceMeters: 0,
        durationSeconds: 0,
        path: [],
        center: null,
        destination: null,
        hasRoute: false,
    });

    /*
     * Load parking GeoJSON.
     */
    useEffect(() => {
        let cancelled = false;

        fetch(GEOJSON_URL)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(
                        `GeoJSON request failed: ${response.status}`
                    );
                }

                return response.json();
            })
            .then((geojson) => {
                if (cancelled) return;
                setPolygons(extractPolygons(geojson));
                setGeoJsonLoaded(true);
            })
            .catch((error) => {
                console.error(
                    "Unable to load parking GeoJSON:",
                    error
                );

                if (!cancelled) {
                    setGeoJsonLoaded(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, []);

    /*
    * Load city limits GeoJSON.
    */
    useEffect(() => {
        let cancelled = false;

        fetch(CITY_LIMITS_URL)
            .then((response) => {
                if (!response.ok) {
                    throw new Error(
                        `City limits GeoJSON request failed: ${response.status}`
                    );
                }

                return response.json();
            })
            .then((geojson) => {
                if (cancelled) return;

                setCityLimits(extractPolygons(geojson));
                setCityLimitsLoaded(true);
            })
            .catch((error) => {
                console.error(
                    "Unable to load city limits GeoJSON:",
                    error
                );

                if (!cancelled) {
                    setCityLimitsLoaded(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [geoJsonLoaded]);

    /*
     * Calculate total acreage of ALL parking polygons.
     */
    const totalParkingAcres = useMemo(() => {
        if (!polygons.length) {
            return 0;
        }

        return polygons.reduce(
            (total, polygon) => {
                return (
                    total +
                    areaAcres(
                        polygon.paths
                    )
                );
            },
            0
        );
    }, [polygons]);

    /*
 * Calculate total acreage inside the city limits.
 */
    const totalCityAcres = useMemo(() => {
        if (!cityLimits.length) {
            return 0;
        }

        return cityLimits.reduce(
            (total, polygon) => {
                return (
                    total +
                    areaAcres(polygon.paths)
                );
            },
            0
        );
    }, [cityLimits]);

    /*
     * Calculate the percentage of the city occupied by
     * off-street parking.
     */
    const cityParkingPercent = useMemo(() => {
        if (
            totalCityAcres <= 0 ||
            totalParkingAcres <= 0
        ) {
            return 0;
        }

        return (
            totalParkingAcres /
            totalCityAcres
        ) * 100;
    }, [totalParkingAcres, totalCityAcres]);

    return (
        <Map
            id="thibodaux-map"
            mapId="fd252fc514f0c142d139c0f4"
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
            {/* ============================================
                DRAWING CONTROLS
                ============================================ */}

            <TerraDrawLayer>
                {(draw) => (
                    <>
                        <TerraDrawAnalysis
                            draw={draw}
                            parkingPolygons={polygons}
                            onAnalysis={setDrawAnalysis}
                            analysisEnabled={analysisEnabled}
                        />

                        <TerraDrawWalkingDistance
                            draw={draw}
                            onWalkingDistance={setWalkingDistance}
                            analysisEnabled={analysisEnabled}
                        />

                        <MapControl
                            position={
                                ControlPosition.TOP_LEFT
                            }
                        >
                            <div className="terra-draw-toolbar">
                                <DrawingControls
                                    draw={draw}
                                    analysisEnabled={analysisEnabled}
                                    onAnalysisEnabledChange={setAnalysisEnabled}
                                />

                                <GeoJsonControls
                                    draw={draw}
                                    polygons={polygons}
                                    onImport={handleGeoJsonImport}
                                    analysisEnabled={analysisEnabled}
                                    onAnalysisEnabledChange={setAnalysisEnabled}
                                />
                            </div>
                        </MapControl>
                    </>
                )}
            </TerraDrawLayer>

            {walkingDistance?.hasRoute &&
                walkingDistance?.path.length > 1 && (
                    <>
                        <Polyline
                            path={walkingDistance.path}
                            strokeColor="#2563eb"
                            strokeOpacity={0.9}
                            strokeWeight={5}
                            zIndex={10}
                        />

                        {walkingDistance.destination && (
                            <AdvancedMarker
                                position={
                                    walkingDistance.destination
                                }
                            >
                                <div
                                    style={{
                                        background: "white",
                                        padding: "7px 10px",
                                        borderRadius: "6px",
                                        boxShadow:
                                            "0 2px 6px rgba(0,0,0,0.3)",
                                        fontFamily:
                                            "system-ui, sans-serif",
                                        whiteSpace: "nowrap",
                                        fontSize: "12px",
                                        fontWeight: "600",
                                    }}
                                >
                                    <div>
                                        {(
                                            walkingDistance.distanceMeters /
                                            1609.344
                                        ).toFixed(2)}{" "}
                                        mi
                                    </div>

                                    <div
                                        style={{
                                            fontSize: "11px",
                                            color: "#666",
                                            fontWeight: "400",
                                        }}
                                    >
                                        {Math.ceil(
                                            walkingDistance.durationSeconds /
                                            60
                                        )}{" "}
                                        min walk
                                    </div>
                                </div>
                            </AdvancedMarker>
                        )}
                    </>
                )}

            {/* ============================================
                METRICS
                ============================================ */}

            <MapControl
                position={
                    ControlPosition.TOP_RIGHT
                }
            >
                <AnalysisCard
                    totalParkingAcres={totalParkingAcres}
                    totalCityAcres={totalCityAcres}
                    cityParkingPercent={cityParkingPercent}
                    polygonCount={polygons.length}
                    analysis={drawAnalysis}
                    walkingDistance={walkingDistance}
                />
            </MapControl>

            {/* ============================================
                CITY LIMITS
                ============================================ */}

            {cityLimits.map((polygon, index) => (
                <Polygon
                    key={`city-limit-${index}`}
                    paths={polygon.paths}
                    options={{
                        fillColor: "#ffffff",
                        fillOpacity: 0.04,
                        strokeColor: "#ffffff",
                        strokeOpacity: 0.85,
                        strokeWeight: 2,
                        clickable: false,
                        zIndex: 1,
                    }}
                />
            ))}

            {/* ============================================
                PARKING POLYGONS
                ============================================ */}

            <ParkingLayer
                polygons={polygons}
                onHoverChange={(acres) => setHoveredArea(acres)}
            />
        </Map>
    );
}


/* ============================================================
   APP
   ============================================================ */

export default function App() {
    const apiKey =
        import.meta.env
            .VITE_GOOGLE_MAPS_API_KEY;

    if (!apiKey) {
        return (
            <div
                style={{
                    padding: 24,
                    fontFamily:
                        "system-ui, sans-serif",
                }}
            >
                <h2>
                    Google Maps API key missing
                </h2>

                <p>
                    Add{" "}
                    <code>
                        VITE_GOOGLE_MAPS_API_KEY
                    </code>{" "}
                    to your Vite{" "}
                    <code>.env</code> file and
                    restart the development
                    server.
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