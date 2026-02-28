/**
 * Native SVG shape components to replace @legacy-video/shapes
 *
 * These components render SVG elements that match the Composition shapes API.
 */

import React from 'react';
import {
  makeRect,
  makeCircle,
  makeEllipse,
  makeTriangle,
  makeStar,
  makePolygon,
  makeHeart,
} from './shape-generators';

interface BaseShapeProps {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
  className?: string;
}

/**
 * Rectangle shape component
 */
export const Rect: React.FC<
  BaseShapeProps & {
    width: number;
    height: number;
    cornerRadius?: number;
  }
> = ({ width, height, cornerRadius = 0, fill, stroke, strokeWidth, style, className }) => {
  const { path } = makeRect({ width, height, cornerRadius });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      className={className}
    >
      <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
};

/**
 * Circle shape component
 */
export const Circle: React.FC<
  BaseShapeProps & {
    radius: number;
  }
> = ({ radius, fill, stroke, strokeWidth, style, className }) => {
  const { path, width, height } = makeCircle({ radius });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      className={className}
    >
      <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
};

/**
 * Ellipse shape component
 */
export const Ellipse: React.FC<
  BaseShapeProps & {
    rx: number;
    ry: number;
  }
> = ({ rx, ry, fill, stroke, strokeWidth, style, className }) => {
  const { path, width, height } = makeEllipse({ rx, ry });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      className={className}
    >
      <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
};

/**
 * Triangle shape component
 */
export const Triangle: React.FC<
  BaseShapeProps & {
    length: number;
    direction?: 'up' | 'down' | 'left' | 'right';
    cornerRadius?: number;
  }
> = ({ length, direction = 'up', cornerRadius = 0, fill, stroke, strokeWidth, style, className }) => {
  const { path, width, height } = makeTriangle({ length, direction, cornerRadius });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      className={className}
    >
      <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
};

/**
 * Star shape component
 */
export const Star: React.FC<
  BaseShapeProps & {
    points: number;
    outerRadius: number;
    innerRadius: number;
    cornerRadius?: number;
  }
> = ({ points, outerRadius, innerRadius, cornerRadius = 0, fill, stroke, strokeWidth, style, className }) => {
  const { path, width, height } = makeStar({ points, outerRadius, innerRadius, cornerRadius });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      className={className}
    >
      <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
};

/**
 * Polygon shape component
 */
export const Polygon: React.FC<
  BaseShapeProps & {
    points: number;
    radius: number;
    cornerRadius?: number;
  }
> = ({ points, radius, cornerRadius = 0, fill, stroke, strokeWidth, style, className }) => {
  const { path, width, height } = makePolygon({ points, radius, cornerRadius });

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={style}
      className={className}
    >
      <path d={path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
};

/**
 * Heart shape component
 */
export const Heart: React.FC<
  BaseShapeProps & {
    height: number;
  }
> = ({ height, fill, stroke, strokeWidth, style, className }) => {
  const result = makeHeart({ height });

  return (
    <svg
      width={result.width}
      height={result.height}
      viewBox={`0 0 ${result.width} ${result.height}`}
      style={style}
      className={className}
    >
      <path d={result.path} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
    </svg>
  );
};
