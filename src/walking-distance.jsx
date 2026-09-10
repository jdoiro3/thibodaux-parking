import { useEffect, useMemo, useState } from "react";


function TerraDrawWalkingDistance({
    draw,
    onWalkingDistance,
    analysisEnabled
}) {
    useEffect(() => {
        if (!analysisEnabled) {
            onWalkingDistance(null);
            return;
        }

        if (!draw) return;

        let timeoutId = null;
        let requestId = 0;

        const calculateWalkingDistance = async () => {
            const snapshot = draw.getSnapshot();

            const polygons = snapshot.filter(
                (feature) =>
                    feature?.geometry?.type === "Polygon" ||
                    feature?.geometry?.type === "MultiPolygon"
            );

            if (!polygons.length) {
                onWalkingDistance({
                    distanceMeters: 0,
                    durationSeconds: 0,
                    path: [],
                    center: null,
                    destination: null,
                    hasRoute: false,
                });

                return;
            }

            const circle =
                polygons[polygons.length - 1];

            let coordinates = [];

            if (
                circle.geometry.type ===
                "Polygon"
            ) {
                coordinates =
                    circle.geometry.coordinates?.[0] ||
                    [];
            } else if (
                circle.geometry.type ===
                "MultiPolygon"
            ) {
                coordinates =
                    circle.geometry.coordinates?.[0]?.[0] ||
                    [];
            }

            if (coordinates.length < 4) {
                return;
            }

            /*
             * Calculate the center of the circle.
             *
             * For a TerraDraw circle represented as a
             * polygon, averaging the vertices gives a
             * good approximation of its center.
             */
            const center = coordinates.reduce(
                (acc, [lng, lat]) => ({
                    lng: acc.lng + lng,
                    lat: acc.lat + lat,
                }),
                { lng: 0, lat: 0 }
            );

            center.lng /= coordinates.length;
            center.lat /= coordinates.length;

            /*
             * Find the point on the circle farthest
             * from its center.
             */
            let destination = null;
            let maxDistance = 0;

            for (const [lng, lat] of coordinates) {
                const distance =
                    Math.pow(
                        lng - center.lng,
                        2
                    ) +
                    Math.pow(
                        lat - center.lat,
                        2
                    );

                if (distance > maxDistance) {
                    maxDistance = distance;

                    destination = {
                        lat,
                        lng,
                    };
                }
            }

            if (!destination) {
                return;
            }

            const currentRequest = ++requestId;

            try {
                const { Route } =
                    await google.maps.importLibrary(
                        "routes"
                    );

                const { routes } =
                    await Route.computeRoutes({
                        origin: {
                            lat: center.lat,
                            lng: center.lng,
                        },

                        destination,

                        travelMode: "WALKING",

                        /*
                         * Request both the walking route
                         * and its distance/duration.
                         */
                        fields: [
                            "path",
                            "distanceMeters",
                            "durationMillis",
                        ],
                    });

                if (
                    currentRequest !==
                    requestId
                ) {
                    return;
                }

                if (!routes?.length) {
                    onWalkingDistance({
                        distanceMeters: 0,
                        durationSeconds: 0,
                        path: [],
                        center: null,
                        destination: null,
                        hasRoute: false,
                    });

                    return;
                }

                const route = routes[0];

                /*
                 * Convert Google's LatLngAltitude
                 * objects into the format expected
                 * by react-google-maps Polyline.
                 */
                const path = (route.path || [])
                    .map((point) => {
                        const lat =
                            typeof point.lat === "function"
                                ? point.lat()
                                : point.lat;

                        const lng =
                            typeof point.lng === "function"
                                ? point.lng()
                                : point.lng;

                        return { lat, lng };
                    })
                    .filter(
                        (point) =>
                            Number.isFinite(point.lat) &&
                            Number.isFinite(point.lng)
                    );

                onWalkingDistance({
                    distanceMeters:
                        route.distanceMeters ||
                        0,

                    durationSeconds:
                        (route.durationMillis ||
                            0) / 1000,

                    path,

                    center: {
                        lat: center.lat,
                        lng: center.lng,
                    },

                    destination,

                    hasRoute: path.length > 1,
                });
            } catch (error) {
                console.error(
                    "Unable to calculate walking route:",
                    error
                );

                onWalkingDistance({
                    distanceMeters: 0,
                    durationSeconds: 0,
                    path: [],
                    center: null,
                    destination: null,
                    hasRoute: false,
                });
            }
        };

        /*
         * Delay route requests while the user is
         * actively modifying the circle.
         */
        const scheduleCalculation = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            timeoutId = setTimeout(
                calculateWalkingDistance,
                500
            );
        };

        const handleChange = () => {
            scheduleCalculation();
        };

        const handleFinish = () => {
            calculateWalkingDistance();
        };

        draw.on(
            "change",
            handleChange
        );

        draw.on(
            "finish",
            handleFinish
        );

        calculateWalkingDistance();

        return () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }

            draw.off(
                "change",
                handleChange
            );

            draw.off(
                "finish",
                handleFinish
            );
        };
    }, [
        draw,
        analysisEnabled,
        onWalkingDistance
    ]);

    return null;
}

export { TerraDrawWalkingDistance };