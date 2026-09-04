export function areaAcres(paths) {
    if (!window.google?.maps?.geometry?.spherical) return 0;

    const outer = paths?.[0] || paths || [];
    if (outer.length < 3) return 0;

    return (
        window.google.maps.geometry.spherical.computeArea(
            outer.map((p) => new window.google.maps.LatLng(p.lat, p.lng))
        ) / 4046.8564224
    );
}