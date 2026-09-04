import { useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { TerraDraw } from "terra-draw";
import { TerraDrawGoogleMapsAdapter } from "terra-draw-google-maps-adapter";

import { createTerraDrawModes } from "./terra-draw-config";

export const useTerraDraw = () => {
  const map = useMap();
  const drawRef = useRef<TerraDraw | null>(null);
  const [draw, setDraw] = useState<TerraDraw | null>(null);

  useEffect(() => {
    if (!map || drawRef.current) return;

    let isCancelled = false;
    let projectionListener: google.maps.MapsEventListener | null = null;

    const initialize = () => {
      if (drawRef.current || isCancelled) return;

      const instance = new TerraDraw({
        adapter: new TerraDrawGoogleMapsAdapter({
          map,
          lib: google.maps,
          coordinatePrecision: 9,
        }),
        modes: createTerraDrawModes(),
      });

      instance.start();

      instance.on("ready", () => {
        if (isCancelled) return;

        drawRef.current = instance;
        setDraw(instance);
      });
    };

    if (map.getProjection()) {
      initialize();
    } else {
      projectionListener = map.addListener("projection_changed", () => {
        if (!map.getProjection()) return;

        projectionListener?.remove();
        projectionListener = null;

        initialize();
      });
    }

    return () => {
      isCancelled = true;

      projectionListener?.remove();

      if (drawRef.current) {
        drawRef.current.stop();
        drawRef.current = null;
      }

      setDraw(null);
    };
  }, [map]);

  return draw;
};