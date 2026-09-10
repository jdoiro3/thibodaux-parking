import * as React from 'react';
import type { TerraDraw } from 'terra-draw';
import { parkingPolygonToTurf } from './polygons';

type GeoJsonControlsProps = {
    draw: TerraDraw | null;
    polygons: any[];
    onImport: (geojson: any) => void;
    analysisEnabled: boolean;
    onAnalysisEnabledChange: (enabled: boolean) => void;
};

const GeoJsonControls = ({
    draw,
    polygons,
    onImport,
    analysisEnabled,
    onAnalysisEnabledChange
}: GeoJsonControlsProps) => {
    const inputRef = React.useRef<HTMLInputElement | null>(null);

    const handleExport = () => {
        if (!draw) return;

        // Convert the initially loaded parking polygons
        // into real GeoJSON Features.
        const initialFeatures = polygons
            .map(parkingPolygonToTurf)
            .filter(Boolean);

        // Get anything currently stored in Terra Draw.
        const drawnFeatures = draw.getSnapshot();

        // Combine both datasets.
        const features = [
            ...initialFeatures,
            ...drawnFeatures
        ];

        const geojson = {
            type: 'FeatureCollection',
            features
        };

        const data = JSON.stringify(
            geojson,
            null,
            2
        );

        const blob = new Blob(
            [data],
            { type: 'application/geo+json' }
        );

        const url =
            URL.createObjectURL(blob);

        const link =
            document.createElement('a');

        link.href = url;
        link.download =
            'thib-parking-lots.geojson';

        link.click();

        URL.revokeObjectURL(url);
    };

    const handleUploadClick = () => {
        inputRef.current?.click();
    };

    const handleFileChange: React.ChangeEventHandler<
        HTMLInputElement
    > = event => {
        if (!draw) return;

        const file = event.target.files?.[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = e => {
            try {
                const geojson =
                    JSON.parse(
                        e.target?.result as string
                    );

                if (
                    geojson?.type !==
                    'FeatureCollection'
                ) {
                    alert(
                        'Invalid GeoJSON: expected FeatureCollection.'
                    );
                    return;
                }

                // Update React's parking dataset
                // so ParkingLayer uses the imported
                // GeoJSON as the new initial dataset.
                onImport(geojson);

            } catch (error) {
                console.error(error);

                alert(
                    'Unable to parse GeoJSON file.'
                );
            }
        };

        reader.readAsText(file);

        // Allow importing the same file again.
        event.target.value = '';
    };

    return (
        <div className="terra-draw-toolbar-group">
            <div className="terra-draw-toolbar-row">

                <button
                    type="button"
                    className="terra-draw-button"
                    onClick={handleExport}
                    disabled={!draw}
                >
                    Export GeoJSON
                </button>

                <button
                    type="button"
                    className="terra-draw-button"
                    onClick={handleUploadClick}
                    disabled={!draw}
                >
                    Import GeoJSON
                </button>

            </div>
            <input
                ref={inputRef}
                type="file"
                accept="application/geo+json,application/json,.geojson"
                className="terra-draw-file-input"
                onChange={handleFileChange}
            />
        </div>
    );
};

export default React.memo(
    GeoJsonControls
);