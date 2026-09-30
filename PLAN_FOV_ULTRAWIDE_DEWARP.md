# Plan de Implementación: Replicación Exacta de FOV Options de Insta360 Studio (Dewarping Rectilíneo)

## 1. Diagnóstico del Error y Estado Actual

Al analizar a fondo el flujo de datos entre la UI de FreeCut y el pipeline de shaders WebGPU:

1. **La causa exacta por la que Linear y Narrow solo hacían "un puto zoom"**:
   - En [`src/infrastructure/gpu-effects/effects/projection-360.ts`](file:///e:/freecut-main/src/infrastructure/gpu-effects/effects/projection-360.ts), la estructura uniforme `Projection360Params` tiene el campo `dewarpMode: f32` en el índice flotante 14.
   - Sin embargo, en la función `packUniforms`, el índice 14 estaba **fijado en código duro a `0.0`**:
     ```ts
     return new Float32Array([
       width, height, width, height,
       fov, distance, distortion, yaw, pitch, roll,
       horizonLock, horizonOffset,
       isEnabled ? 1.0 : 0.0,
       sourceMode,
       0.0, // <-- ¡ESTE VALOR ESTABA EN 0.0 FIJO!
       0.0,
     ])
     ```
   - En el shader WGSL:
     ```wgsl
     if (params.dewarpMode < 0.5) {
       // SUBMODO A: UltraWide & Wide (zoom sin aplanado)
     } else {
       // SUBMODO B: Linear, Narrow, Horizont (Dewarping / Aplanado)
     }
     ```
   - Al estar siempre en `0.0`, **el Submodo B NUNCA se ejecutaba**. Cuando el usuario seleccionaba Linear o Narrow, el shader siempre ejecutaba el Submodo A (que solo cambiaba el FOV con zoom), provocando que las líneas curvas permanecieran curvas sin enderezarse.

2. **Por qué UltraWide y Wide NO DEBEN TOCARSE**:
   - El usuario confirmó categóricamente: **"el ultrawide y el wide ahora si son perfectos"**.
   - En el Submodo A (`params.dewarpMode < 0.5`), el comportamiento óptico de lente nativa gran angular ya está perfecto y aprobado.
   - **Regla inmutable**: Para `ultra-wide` y `wide`, `dewarpMode` DEBE SER estrictamente `0.0`. Su código en el Submodo A permanece intacto y 100% intocado.

3. **Replicación Exacta de Insta360 Studio**:
   - En Insta360 Studio, cuando se selecciona **Linear** o **Narrow** sobre un video gran angular/UltraWide de cámara de acción:
     - Se elimina al 100% la distorsión de barril (curvatura de ojo de pez).
     - Todas las líneas rectas del mundo real (árboles, postes, paredes, marcos, horizonte) se convierten en líneas 100% rectas (**rectilíneo / pinhole**).
     - Se ajusta el campo de visión (FOV 78° para Linear, FOV 55° para Narrow) sin bordes negros ni deformaciones.
     - **45° Horizont** y **360° Horizont** aplican la misma corrección rectilínea plana junto con la nivelación del horizonte.

---

## 2. Solución de Ingeniería

### A. Corrección en `packUniforms` ([`projection-360.ts`](file:///e:/freecut-main/src/infrastructure/gpu-effects/effects/projection-360.ts))
Garantizar la separación estricta:
```ts
const preset = p.preset as string | undefined
let isDewarpMode = 0.0
if (preset === 'ultra-wide' || preset === 'wide') {
  // UltraWide y Wide permanecen al 100% en la óptica nativa que el usuario ya aprobó
  isDewarpMode = 0.0
} else if (
  preset === 'linear' ||
  preset === 'narrow' ||
  preset === 'horizon-45' ||
  preset === 'horizon-360'
) {
  // Linear, Narrow y Horizont aplican dewarping rectilíneo para aplanar líneas curvas
  isDewarpMode = 1.0
} else if (preset === 'custom') {
  isDewarpMode = Number(p.distortion ?? 0) > 0.05 ? 1.0 : 0.0
} else {
  isDewarpMode = Number(p.distortion ?? 0) > 0.3 ? 1.0 : 0.0
}
```
Y pasar `isDewarpMode` en el float 14 del `Float32Array`.

### B. Submodo B en el Shader WGSL (Desanamorfizado Rectilíneo Puro)
En el Submodo B (`params.dewarpMode >= 0.5`):
- Se proyecta el rayo de pantalla rectilíneo con el FOV objetivo (`params.fov`).
- Se aplica rotación 3D para Roll (y Horizon Lock), Pitch y Yaw.
- Se aplica el factor óptico de desanamorfizado simétrico circular:
  $$r^2 = \frac{coord.x^2 + coord.y^2}{aspect^2 + 1.0}$$
  $$\text{dewarpFactor} = \frac{1.0}{1.0 + 0.52 \cdot \text{clamp}(\text{params.distortion}, 0.1, 1.0) \cdot r^2}$$
  $$coord = coord \cdot \text{dewarpFactor}$$
- Al ser circularmente simétrico, las líneas horizontales (horizonte, techos) y verticales (postes, paredes) se enderezan exactamente igual en todas las direcciones, replicando con fidelidad matemática el motor de Insta360 Studio.

---

## 3. Matriz de Comportamiento por Presets

| Preset | `dewarpMode` | Submodo Shader | Apariencia | Líneas Curvas | Nivelación Horizonte |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **UltraWide** | `0.0` | **Submodo A** (Intocado) | Vista nativa cámara de acción | Curvas naturales | Roll manual |
| **Wide** | `0.0` | **Submodo A** (Intocado) | Gran angular nativo con leve zoom | Curvas naturales | Roll manual |
| **Linear** | `1.0` | **Submodo B** (Dewarp Activo) | Rectilíneo Insta360 Studio (78° FOV) | **100% Rectas y Planas** | Roll manual |
| **Narrow** | `1.0` | **Submodo B** (Dewarp Activo) | Teleobjetivo rectilíneo (55° FOV) | **100% Rectas y Planas** | Roll manual |
| **45° Horizont** | `1.0` | **Submodo B** (Dewarp Activo) | Rectilíneo estabilizado | **100% Rectas y Planas** | Bloqueo $\pm 45^\circ$ |
| **360° Horizont** | `1.0` | **Submodo B** (Dewarp Activo) | Rectilíneo nivelado 360° | **100% Rectas y Planas** | Bloqueo absoluto $360^\circ$ |
| **Libre (Custom)** | Dinámico | Según distorsión | Control continuo con sliders | Regulable con slider | Roll / Offset manual |
