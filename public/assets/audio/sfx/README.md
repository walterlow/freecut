# Biblioteca de Efectos de Sonido (SFX) de FreeCut

Esta carpeta está destinada a almacenar los archivos de audio estáticos de efectos de sonido (`.wav`, `.mp3`) para ser utilizados dentro de la pestaña de **Audio > Efectos de Sonido** en FreeCut.

---

## 📁 Ruta de la carpeta
`public/assets/audio/sfx/`

---

## 🛠️ Instrucciones para que se reflejen en la aplicación

### Paso 1: Copiar los archivos de audio
Copia tus archivos de audio en formato `.wav` o `.mp3` dentro de esta carpeta:
```
public/assets/audio/sfx/
  ├── mi-efecto-transicion.wav
  ├── impacto-cinematico.wav
  └── click-suave.mp3
```

### Paso 2: Registrar los efectos en el catálogo
Abre el archivo de configuración del catálogo:
`src/features/editor/components/audio-tab/sfx-catalog.ts`

Y añade tus archivos al arreglo `SFX_ITEMS`:
```typescript
export const SFX_ITEMS: SfxItem[] = [
  {
    id: 'mi-efecto-transicion',
    name: 'Transición Rápida',
    category: 'transitions', // Opciones: 'transitions' | 'ui' | 'foley'
    duration: 1.2, // Duración en segundos
    description: 'Sonido de barrido rápido para cortes',
    assetPath: '/assets/audio/sfx/mi-efecto-transicion.wav',
  },
  {
    id: 'impacto-cinematico',
    name: 'Impacto Cinemático',
    category: 'transitions',
    duration: 2.5,
    description: 'Golpe grave de bajo profundo',
    assetPath: '/assets/audio/sfx/impacto-cinematico.wav',
  },
]
```

### Paso 3: Listo
Al guardar, Vite recargará automáticamente la aplicación y los efectos aparecerán listados en la pestaña **Efectos de Sonido** con su botón de preescucha e inserción en la línea de tiempo.
