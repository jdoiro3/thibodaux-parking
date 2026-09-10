import {
    useEffect,
    useRef,

} from "react";
import { parkingPolygonToTurf } from './utils';

function InitialTerraDrawFeatures({ draw, parkingPolygons }) {
    const initializedDrawRef = useRef(null);

    useEffect(() => {
        if (!draw) return;
        if (!parkingPolygons || parkingPolygons.length === 0) return;

        // Don't initialize the same Terra Draw instance twice.
        if (initializedDrawRef.current === draw) {
            return;
        }

        const features = parkingPolygons
            .map((parkingPolygon) => {
                const feature =
                    parkingPolygonToTurf(parkingPolygon);

                if (!feature) return null;

                return {
                    type: "Feature",
                    geometry: feature.geometry,
                    properties: {
                        ...(parkingPolygon.properties || {}),
                        source: "initial-parking",
                    },
                };
            })
            .filter(Boolean);

        if (features.length === 0) {
            console.warn(
                "No valid parking polygons could be converted to Terra Draw features."
            );
            return;
        }

        console.log(
            `Adding ${features.length} initial parking polygons to Terra Draw`
        );

        try {
            //const results = draw.addFeatures(features);

            // Verify that Terra Draw actually received them.
            const snapshot = draw.getSnapshot();

            console.log(
                `Terra Draw now contains ${snapshot.length} features`
            );

            initializedDrawRef.current = draw;
        } catch (error) {
            console.error(
                "Failed to add initial parking polygons to Terra Draw:",
                error
            );
        }
    }, [draw, parkingPolygons]);

    return null;
}

export { InitialTerraDrawFeatures };