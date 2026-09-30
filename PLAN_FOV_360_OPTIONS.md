# Plan de Implementación: FOV Options & Soporte Completo 360° en FreeCut

> **Referencia de Diseño:** Basado en el análisis de arquitectura y parámetros del software **Insta360 Studio** instalado en el sistema (`C:\Program Files\Insta360 Studio`).

---

## 1. Análisis de Insta360 Studio

Al examinar la instalación de Insta360 Studio (módulos de proyección, esquemas `data/pano_animation/*.json`, librerías OpenGL/DirectML y diccionarios de traducción `es-ES.json` / `en-US.json`), se extrajeron los parámetros exactos de su sistema de **Reframe / Dewarp**:

### 1.1 Tabla de Presets FOV (Opciones de Lente)

| # | Opción | Nombre en Insta360 Studio | Rango FOV | Tipo de Proyección | Comportamiento del Horizonte |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **1** | **UltraWide** | *Ultra Ancho / Super angular* | **115° – 130°** | Proyección Pannini / Cilíndrica estereográfica | Máxima amplitud de campo; de-warp suave en la periferia para evitar estiramiento extremo de bordes. |
| **2** | **Wide** | *Wide / Gran Angular* | **95° – 105°** | Curvilíneo de acción estándar | Perspectiva clásica de cámara de acción con corrección moderada de distorsión. |
| **3** | **Linear** | *Linear / Sin Distorsión* | **75° – 85°** | Rectilíneo puro (Gnomónico / Pinhole) | **Elimina por completo la curvatura de ojo de pez**. Las líneas rectas (edificios, puertas, postes, horizonte) se mantienen rectas. |
| **4** | **Narrow** | *Narrow / Estrecho* | **50° – 65°** | Rectilíneo teleobjetivo | Encuadre cerrado hacia el centro del encuadre sin deformación de bordes. |
| **5** | **45° Horizont** | *45° Nivelación de Horizonte* | Según lente (~80°) | Rectilíneo / Pannini con estabilización de Roll | Mantiene el horizonte nivelado en balanceos de hasta $\pm 45^\circ$. Si la cámara se inclina más allá de $45^\circ$, acompaña el movimiento suavemente. |
| **6** | **360° Horizont** | *360° Nivelación de Horizonte* | Según lente (~80°) | Rectilíneo / Pannini con bloqueo absoluto de Roll | **Nivelación horizontal de 360° completa**. Aunque la cámara dé giros completos o volteretas (drones, motos, palos selfie), el horizonte permanece siempre horizontal. |
| **7** | **Libre (Custom)** | *Control FOV* | **30° – 150°** (Variable) | Paramétrico con sliders múltiples | Control total y personalizado de FOV, distancia, curvatura y ángulos 3D. |

---

## 2. Controles del Modo Libre (Custom Sliders)

Al seleccionar la opción **Libre**, se habilitan los siguientes sliders con entrada numérica y soporte para keyframes:

1. **Horizontal FOV (Campo de Visión):** Rango de **30° a 150°** (por defecto 75°).
2. **Distancia / Zoom:** Rango de **0.5x a 3.0x** (distancia focal equivalente de la cámara virtual).
3. **Control de Distorsión / Curvatura:** Rango de **0% (Rectilíneo / Plano)** a **100% (Ojo de pez natural)**.
4. **Giro Horizontal (Yaw / Pan):** Rango de **-180° a +180°** (rotación horizontal sobre la esfera 360°).
5. **Inclinación Vertical (Pitch / Tilt):** Rango de **-90° a +90°** (mirar hacia el cielo o hacia el suelo).
6. **Rotación de Eje (Roll):** Rango de **-180° a +180°** (balanceo lateral de la cámara).
7. **Nivel de Horizonte (Horizon Offset):** Rango de **-45° a +45°** (calibración manual si la cámara se montó desnivelada).
8. **Botón Reset:** Restablece la vista al frente centrado (0° Yaw, 0° Pitch, 0° Roll, 75° FOV).

---

## 3. Soporte Completo de Formatos de Video e Imagen 360°

Se añade compatibilidad directa en la biblioteca de medios sin necesidad de renombrar ni convertir archivos previamente:

- **Formatos Nativos de Cámaras Insta360:**
  - **`.insv` (Insta360 Video):** Contenedor MP4 nativo con flujo de video equirrectangular y metadatos de giro. Se registra con MIME `video/mp4` para decodificación directa en mediabunny / WebCodecs.
  - **`.insp` (Insta360 Photo):** Imagen JPEG panorámica esférica con metadatos EXIF. Se registra con MIME `image/jpeg`.
- **Formatos Panorámicos Estándar:**
  - Videos en `.mp4`, `.mov`, `.webm`, `.mkv` con proyección equirrectangular 2:1 (ej. 5760x2880, 3840x1920, 1920x960).
  - Fotos en `.jpg`, `.jpeg`, `.png`, `.webp` en proporción 2:1.
- **Detección Automática:**
  - Si un archivo importado tiene relación de aspecto 2:1 o extensión `.insv` / `.insp`, se cataloga como medio 360° con una etiqueta visual "360°" en la biblioteca y se preconfigura la proyección en la línea de tiempo.

---

## 4. Control Interactivo en Pantalla (Preview Orbit) y Reframe

- **Navegación con Ratón en el Preview:**
  - **Clic y arrastrar en la pantalla del video:** Rota la cámara en tiempo real (Yaw y Pitch) para buscar el encuadre deseado en 360°.
  - **Rueda del ratón (Scroll):** Modifica el FOV / Zoom de forma intuitiva.
- **Reframe con Keyframes (Animación Dinámica):**
  - Cada propiedad (Yaw, Pitch, Roll, FOV, Distorsión) cuenta con su interruptor de keyframe.
  - Permite crear movimientos de cámara cinematográficos: iniciar mirando hacia el frente y realizar giros fluidos hacia cualquier punto de interés mientras transcurre el video.

---

## 5. Fases de Implementación Técnica

```
┌──────────────────────────────────────────────────────────────┐
│ FASE 1: Formatos de Archivo y Mapeo MIME                     │
│ - src/features/media-library/utils/media-file-picker.ts      │
│   (añadir .insv y .insp a los selectores de archivo)         │
│ - src/features/media-library/utils/validation.ts             │
│   (mapear extensiones .insv -> video/mp4, .insp -> image/jpeg)│
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ FASE 2: Tipos y Modelo de Datos                              │
│ - src/types/projection360.ts (nuevo modelo Projection360)    │
│ - src/types/timeline.ts (incorporar proyección en TimelineItem)│
│ - src/types/keyframe.ts (propiedades animables de cámara 360) │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ FASE 3: Motor de Proyección WebGPU (Shaders WGSL)            │
│ - Shader de remapeo Equirrectangular a Perspectiva 2D         │
│ - Algoritmos de corrección Pannini / Rectilíneo              │
│ - Matriz de rotación 3D Euler + algoritmos de Horizon Lock   │
│ - Muestreo bilineal continuo en la unión de 360° (sin costura)│
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ FASE 4: Interfaz de Usuario (Properties Sidebar)             │
│ - src/features/editor/components/properties-sidebar/clip-panel│
│   /projection-360-section.tsx (nuevo componente)             │
│ - Botones de Presets (UltraWide, Wide, Linear, Narrow,       │
│   45° Horizont, 360° Horizont, Libre)                        │
│ - Bloque de Sliders interactivos con valores numéricos       │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ FASE 5: Control Interactivo en Preview Canvas                │
│ - Manejador de eventos pointer para arrastrar la cámara      │
│ - Control de zoom con rueda de ratón                         │
│ - Sincronización bidireccional con los sliders del inspector │
└──────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────┐
│ FASE 6: Exportador y Verificación                            │
│ - Integración en el worker de renderizado de exportación      │
│ - Exportación reframada en cualquier relación de aspecto     │
│   (16:9 horizontal, 9:16 vertical TikTok/Reels, 1:1, etc.)  │
│ - Ejecución y verificación con la suite de pruebas unitarias  │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Garantías de No Regresión
- Los clips convencionales 2D (video, imagen, texto, formas) continuarán operando de manera idéntica sin ningún impacto en rendimiento.
- La reproducción de audio y arrastre de medios desde discos duros externos y USB se mantendrá 100% intacta.
