import React, { useState, useMemo } from 'react';
import { Polygon, InfoWindow } from '@vis.gl/react-google-maps';
import { areaAcres } from './utils'; 
import { polygon as turfPolygon } from "@turf/helpers";

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
