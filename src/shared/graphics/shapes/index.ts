/**
 * Native shape utilities
 *
 * Replaces @legacy-video/shapes and @legacy-video/paths with native implementations.
 */

// Shape path generators
export {
  makeRect,
  makeCircle,
  makeEllipse,
  makeTriangle,
  makeStar,
  makePolygon,
  makeHeart,
} from './shape-generators';

// Path transformation utilities
export { scalePath, translatePath } from './path-utils';

// Shape React components
export { Rect, Circle, Ellipse, Triangle, Star, Polygon, Heart } from './components';
