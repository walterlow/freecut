/**
 * Test Fixture Generator
 *
 * Generates sample project data for testing, debugging, and development.
 * Provides various project configurations from empty to complex multi-track timelines.
 */

import type { Project, ProjectTimeline } from '@/types/project';
import type { ProjectSnapshot } from '../types/snapshot';
import { SNAPSHOT_VERSION } from '../types/snapshot';

// ============================================================================
// Types
// ============================================================================

export type FixtureType =
  | 'empty'
  | 'single-video'
  | 'single-audio'
  | 'single-image'
  | 'single-text'
  | 'multi-track'
  | 'with-transitions'
  | 'with-keyframes'
  | 'complex'
  | 'stress-test';

export interface FixtureOptions {
  /** Project name override */
  name?: string;
  /** Project resolution width */
  width?: number;
  /** Project resolution height */
  height?: number;
  /** Frames per second */
  fps?: number;
  /** Background color */
  backgroundColor?: string;
  /** Number of tracks (for multi-track fixtures) */
  trackCount?: number;
  /** Number of items per track (for stress test) */
  itemsPerTrack?: number;
  /** Duration in frames for items */
  itemDuration?: number;
}

export interface FixtureResult {
  project: Project;
  snapshot: ProjectSnapshot;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_OPTIONS: Required<FixtureOptions> = {
  name: 'Test Project',
  width: 1920,
  height: 1080,
  fps: 30,
  backgroundColor: '#000000',
  trackCount: 3,
  itemsPerTrack: 5,
  itemDuration: 90, // 3 seconds at 30fps
};

const SAMPLE_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6366f1', '#14b8a6',
];

// ============================================================================
// ID Generators
// ============================================================================

let idCounter = 0;

function generateId(prefix: string = 'id'): string {
  idCounter++;
  return `${prefix}-${idCounter.toString().padStart(4, '0')}-${Math.random().toString(36).slice(2, 8)}`;
}

function resetIdCounter(): void {
  idCounter = 0;
}

// ============================================================================
// Base Generators
// ============================================================================

function createBaseProject(options: FixtureOptions = {}): Project {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return {
    id: generateId('project'),
    name: opts.name,
    description: `Generated test fixture: ${opts.name}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    duration: 0,
    metadata: {
      width: opts.width,
      height: opts.height,
      fps: opts.fps,
      backgroundColor: opts.backgroundColor,
    },
  };
}

function createTrack(index: number, name?: string): ProjectTimeline['tracks'][0] {
  return {
    id: generateId('track'),
    name: name || `Track ${index + 1}`,
    height: 80,
    locked: false,
    visible: true,
    muted: false,
    solo: false,
    color: SAMPLE_COLORS[index % SAMPLE_COLORS.length],
    order: index,
  };
}

function createVideoItem(
  trackId: string,
  from: number,
  duration: number,
  label: string
): ProjectTimeline['items'][0] {
  return {
    id: generateId('item'),
    trackId,
    from,
    durationInFrames: duration,
    label,
    type: 'video',
    mediaId: generateId('media'),
    originId: generateId('origin'),
    sourceStart: 0,
    sourceEnd: duration,
    sourceDuration: duration * 2, // Source is longer than clip
    sourceWidth: 1920,
    sourceHeight: 1080,
    volume: 1,
    speed: 1,
    transform: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
      opacity: 1,
    },
  };
}

function createAudioItem(
  trackId: string,
  from: number,
  duration: number,
  label: string
): ProjectTimeline['items'][0] {
  return {
    id: generateId('item'),
    trackId,
    from,
    durationInFrames: duration,
    label,
    type: 'audio',
    mediaId: generateId('media'),
    originId: generateId('origin'),
    sourceStart: 0,
    sourceEnd: duration,
    sourceDuration: duration * 2,
    volume: 1,
    audioFadeIn: 15,
    audioFadeOut: 15,
  };
}

function createImageItem(
  trackId: string,
  from: number,
  duration: number,
  label: string
): ProjectTimeline['items'][0] {
  return {
    id: generateId('item'),
    trackId,
    from,
    durationInFrames: duration,
    label,
    type: 'image',
    mediaId: generateId('media'),
    originId: generateId('origin'),
    sourceWidth: 1920,
    sourceHeight: 1080,
    transform: {
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      rotation: 0,
      opacity: 1,
    },
  };
}

function createTextItem(
  trackId: string,
  from: number,
  duration: number,
  text: string
): ProjectTimeline['items'][0] {
  return {
    id: generateId('item'),
    trackId,
    from,
    durationInFrames: duration,
    label: text,
    type: 'text',
    originId: generateId('origin'),
    text,
    fontSize: 48,
    fontFamily: 'Inter',
    color: '#ffffff',
    transform: {
      x: 960,
      y: 540,
      width: 800,
      height: 100,
      rotation: 0,
      opacity: 1,
    },
  };
}

function createShapeItem(
  trackId: string,
  from: number,
  duration: number,
  shapeType: 'rectangle' | 'circle' | 'triangle'
): ProjectTimeline['items'][0] {
  return {
    id: generateId('item'),
    trackId,
    from,
    durationInFrames: duration,
    label: `${shapeType} shape`,
    type: 'shape',
    originId: generateId('origin'),
    shapeType,
    fillColor: SAMPLE_COLORS[Math.floor(Math.random() * SAMPLE_COLORS.length)],
    strokeColor: '#ffffff',
    strokeWidth: 2,
    transform: {
      x: 960,
      y: 540,
      width: 200,
      height: 200,
      rotation: 0,
      opacity: 1,
    },
  };
}

function createTransition(
  leftClipId: string,
  rightClipId: string,
  trackId: string,
  duration: number = 15
): NonNullable<ProjectTimeline['transitions']>[0] {
  return {
    id: generateId('transition'),
    type: 'crossfade',
    leftClipId,
    rightClipId,
    trackId,
    durationInFrames: duration,
  };
}

function createMarker(
  frame: number,
  label: string,
  color: string = '#ef4444'
): NonNullable<ProjectTimeline['markers']>[0] {
  return {
    id: generateId('marker'),
    frame,
    label,
    color,
  };
}

function createKeyframes(
  itemId: string,
  property: 'x' | 'y' | 'opacity' | 'rotation',
  frames: Array<{ frame: number; value: number }>
): NonNullable<ProjectTimeline['keyframes']>[0] {
  return {
    itemId,
    properties: [
      {
        property,
        keyframes: frames.map((f) => ({
          id: generateId('keyframe'),
          frame: f.frame,
          value: f.value,
          easing: 'ease-in-out' as const,
        })),
      },
    ],
  };
}

// ============================================================================
// Fixture Generators
// ============================================================================

function generateEmptyProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Empty Project' });

  project.timeline = {
    tracks: [createTrack(0)],
    items: [],
    currentFrame: 0,
    zoomLevel: 1,
    scrollPosition: 0,
  };

  return project;
}

function generateSingleVideoProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Single Video Project' });
  const track = createTrack(0, 'Video Track');
  const duration = options.itemDuration || DEFAULT_OPTIONS.itemDuration;

  project.timeline = {
    tracks: [track],
    items: [createVideoItem(track.id, 0, duration, 'Sample Video')],
    currentFrame: 0,
    zoomLevel: 1,
    scrollPosition: 0,
  };

  project.duration = duration;
  return project;
}

function generateSingleAudioProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Single Audio Project' });
  const track = createTrack(0, 'Audio Track');
  const duration = options.itemDuration || DEFAULT_OPTIONS.itemDuration;

  project.timeline = {
    tracks: [track],
    items: [createAudioItem(track.id, 0, duration, 'Sample Audio')],
    currentFrame: 0,
    zoomLevel: 1,
    scrollPosition: 0,
  };

  project.duration = duration;
  return project;
}

function generateSingleImageProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Single Image Project' });
  const track = createTrack(0, 'Image Track');
  const duration = options.itemDuration || DEFAULT_OPTIONS.itemDuration;

  project.timeline = {
    tracks: [track],
    items: [createImageItem(track.id, 0, duration, 'Sample Image')],
    currentFrame: 0,
    zoomLevel: 1,
    scrollPosition: 0,
  };

  project.duration = duration;
  return project;
}

function generateSingleTextProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Single Text Project' });
  const track = createTrack(0, 'Text Track');
  const duration = options.itemDuration || DEFAULT_OPTIONS.itemDuration;

  project.timeline = {
    tracks: [track],
    items: [createTextItem(track.id, 0, duration, 'Hello World')],
    currentFrame: 0,
    zoomLevel: 1,
    scrollPosition: 0,
  };

  project.duration = duration;
  return project;
}

function generateMultiTrackProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Multi-Track Project' });
  const trackCount = options.trackCount || DEFAULT_OPTIONS.trackCount;
  const duration = options.itemDuration || DEFAULT_OPTIONS.itemDuration;

  const tracks = [
    createTrack(0, 'Video Track'),
    createTrack(1, 'Overlay Track'),
    createTrack(2, 'Audio Track'),
  ].slice(0, trackCount);

  const items: ProjectTimeline['items'] = [];

  // Video track: 3 video clips
  if (tracks[0]) {
    items.push(createVideoItem(tracks[0].id, 0, duration, 'Video 1'));
    items.push(createVideoItem(tracks[0].id, duration, duration, 'Video 2'));
    items.push(createVideoItem(tracks[0].id, duration * 2, duration, 'Video 3'));
  }

  // Overlay track: text and shapes
  if (tracks[1]) {
    items.push(createTextItem(tracks[1].id, 30, duration - 30, 'Title Text'));
    items.push(createShapeItem(tracks[1].id, duration + 15, 60, 'circle'));
  }

  // Audio track: audio clips
  if (tracks[2]) {
    items.push(createAudioItem(tracks[2].id, 0, duration * 2, 'Background Music'));
    items.push(createAudioItem(tracks[2].id, duration * 2 + 15, duration, 'Sound Effect'));
  }

  project.timeline = {
    tracks,
    items,
    currentFrame: 0,
    zoomLevel: 1,
    scrollPosition: 0,
    markers: [
      createMarker(0, 'Start', '#22c55e'),
      createMarker(duration, 'Section 2', '#3b82f6'),
      createMarker(duration * 2, 'Section 3', '#8b5cf6'),
    ],
  };

  project.duration = duration * 3;
  return project;
}

function generateWithTransitionsProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Transitions Project' });
  const track = createTrack(0, 'Video Track');
  const duration = options.itemDuration || DEFAULT_OPTIONS.itemDuration;
  const transitionDuration = 15;

  // Create overlapping clips for transitions
  const clip1 = createVideoItem(track.id, 0, duration, 'Clip 1');
  const clip2 = createVideoItem(track.id, duration - transitionDuration, duration, 'Clip 2');
  const clip3 = createVideoItem(track.id, (duration - transitionDuration) * 2, duration, 'Clip 3');

  project.timeline = {
    tracks: [track],
    items: [clip1, clip2, clip3],
    currentFrame: 0,
    zoomLevel: 1,
    scrollPosition: 0,
    transitions: [
      createTransition(clip1.id, clip2.id, track.id, transitionDuration),
      createTransition(clip2.id, clip3.id, track.id, transitionDuration),
    ],
  };

  project.duration = duration * 3 - transitionDuration * 2;
  return project;
}

function generateWithKeyframesProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Keyframes Project' });
  const track = createTrack(0, 'Animated Track');
  const duration = options.itemDuration || 150; // 5 seconds for animation

  const imageItem = createImageItem(track.id, 0, duration, 'Animated Image');
  const textItem = createTextItem(track.id, 30, duration - 60, 'Animated Text');

  project.timeline = {
    tracks: [track],
    items: [imageItem, textItem],
    currentFrame: 0,
    zoomLevel: 1,
    scrollPosition: 0,
    keyframes: [
      // Image: animate position and opacity
      createKeyframes(imageItem.id, 'x', [
        { frame: 0, value: -200 },
        { frame: 30, value: 960 },
        { frame: duration - 30, value: 960 },
        { frame: duration, value: 2120 },
      ]),
      createKeyframes(imageItem.id, 'opacity', [
        { frame: 0, value: 0 },
        { frame: 30, value: 1 },
        { frame: duration - 30, value: 1 },
        { frame: duration, value: 0 },
      ]),
      // Text: animate rotation
      createKeyframes(textItem.id, 'rotation', [
        { frame: 0, value: -10 },
        { frame: 45, value: 0 },
        { frame: 90, value: 10 },
      ]),
    ],
  };

  project.duration = duration;
  return project;
}

function generateComplexProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Complex Project' });
  const duration = options.itemDuration || DEFAULT_OPTIONS.itemDuration;
  const transitionDuration = 15;

  const tracks = [
    createTrack(0, 'Main Video'),
    createTrack(1, 'B-Roll'),
    createTrack(2, 'Graphics'),
    createTrack(3, 'Music'),
    createTrack(4, 'Voice Over'),
  ];

  const items: ProjectTimeline['items'] = [];
  const transitions: NonNullable<ProjectTimeline['transitions']> = [];
  const keyframes: NonNullable<ProjectTimeline['keyframes']> = [];

  // Main video track with transitions
  const mainClip1 = createVideoItem(tracks[0]!.id, 0, duration, 'Interview A');
  const mainClip2 = createVideoItem(tracks[0]!.id, duration - transitionDuration, duration, 'Interview B');
  const mainClip3 = createVideoItem(tracks[0]!.id, (duration - transitionDuration) * 2, duration, 'Interview C');
  items.push(mainClip1, mainClip2, mainClip3);
  transitions.push(
    createTransition(mainClip1.id, mainClip2.id, tracks[0]!.id, transitionDuration),
    createTransition(mainClip2.id, mainClip3.id, tracks[0]!.id, transitionDuration)
  );

  // B-Roll track
  items.push(createVideoItem(tracks[1]!.id, 30, 60, 'B-Roll 1'));
  items.push(createVideoItem(tracks[1]!.id, duration + 15, 45, 'B-Roll 2'));
  items.push(createImageItem(tracks[1]!.id, duration * 2, 60, 'Photo Insert'));

  // Graphics track
  const titleText = createTextItem(tracks[2]!.id, 0, 90, 'Documentary Title');
  const lowerThird = createTextItem(tracks[2]!.id, 45, 75, 'John Smith - Director');
  items.push(titleText, lowerThird);
  items.push(createShapeItem(tracks[2]!.id, duration * 2 + 30, 60, 'rectangle'));

  // Keyframes for title
  keyframes.push(
    createKeyframes(titleText.id, 'opacity', [
      { frame: 0, value: 0 },
      { frame: 15, value: 1 },
      { frame: 75, value: 1 },
      { frame: 90, value: 0 },
    ]),
    createKeyframes(titleText.id, 'y', [
      { frame: 0, value: 600 },
      { frame: 15, value: 540 },
    ])
  );

  // Music track
  items.push(createAudioItem(tracks[3]!.id, 0, duration * 3 - transitionDuration * 2, 'Background Score'));

  // Voice over track
  items.push(createAudioItem(tracks[4]!.id, 60, duration - 30, 'VO Take 1'));
  items.push(createAudioItem(tracks[4]!.id, duration + 45, duration - 60, 'VO Take 2'));

  project.timeline = {
    tracks,
    items,
    transitions,
    keyframes,
    currentFrame: 0,
    zoomLevel: 0.8,
    scrollPosition: 0,
    inPoint: 30,
    outPoint: duration * 3 - transitionDuration * 2 - 30,
    markers: [
      createMarker(0, 'Intro', '#22c55e'),
      createMarker(duration - transitionDuration, 'Act 1', '#3b82f6'),
      createMarker((duration - transitionDuration) * 2, 'Act 2', '#8b5cf6'),
      createMarker(duration * 3 - transitionDuration * 2 - 60, 'Outro', '#ef4444'),
    ],
  };

  project.duration = duration * 3 - transitionDuration * 2;
  return project;
}

function generateStressTestProject(options: FixtureOptions = {}): Project {
  const project = createBaseProject({ ...options, name: options.name || 'Stress Test Project' });
  const trackCount = options.trackCount || 10;
  const itemsPerTrack = options.itemsPerTrack || 20;
  const itemDuration = options.itemDuration || 30;

  const tracks = Array.from({ length: trackCount }, (_, i) => createTrack(i));
  const items: ProjectTimeline['items'] = [];
  const markers: NonNullable<ProjectTimeline['markers']> = [];

  // Generate items for each track
  for (const track of tracks) {
    for (let i = 0; i < itemsPerTrack; i++) {
      const from = i * (itemDuration + 5); // 5 frame gap between items
      const type = i % 3;

      if (type === 0) {
        items.push(createVideoItem(track.id, from, itemDuration, `Video ${i + 1}`));
      } else if (type === 1) {
        items.push(createImageItem(track.id, from, itemDuration, `Image ${i + 1}`));
      } else {
        items.push(createTextItem(track.id, from, itemDuration, `Text ${i + 1}`));
      }
    }
  }

  // Add markers every 100 frames
  const totalDuration = itemsPerTrack * (itemDuration + 5);
  for (let frame = 0; frame < totalDuration; frame += 100) {
    markers.push(createMarker(frame, `Marker ${frame}`, SAMPLE_COLORS[Math.floor(frame / 100) % SAMPLE_COLORS.length]!));
  }

  project.timeline = {
    tracks,
    items,
    markers,
    currentFrame: 0,
    zoomLevel: 0.5,
    scrollPosition: 0,
  };

  project.duration = totalDuration;
  return project;
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Generate a test fixture project by type
 */
export function generateFixture(
  type: FixtureType,
  options: FixtureOptions = {}
): FixtureResult {
  resetIdCounter();

  let project: Project;

  switch (type) {
    case 'empty':
      project = generateEmptyProject(options);
      break;
    case 'single-video':
      project = generateSingleVideoProject(options);
      break;
    case 'single-audio':
      project = generateSingleAudioProject(options);
      break;
    case 'single-image':
      project = generateSingleImageProject(options);
      break;
    case 'single-text':
      project = generateSingleTextProject(options);
      break;
    case 'multi-track':
      project = generateMultiTrackProject(options);
      break;
    case 'with-transitions':
      project = generateWithTransitionsProject(options);
      break;
    case 'with-keyframes':
      project = generateWithKeyframesProject(options);
      break;
    case 'complex':
      project = generateComplexProject(options);
      break;
    case 'stress-test':
      project = generateStressTestProject(options);
      break;
    default:
      throw new Error(`Unknown fixture type: ${type}`);
  }

  const snapshot: ProjectSnapshot = {
    version: SNAPSHOT_VERSION,
    exportedAt: new Date().toISOString(),
    editorVersion: '1.0.0',
    project,
    mediaReferences: [], // No real media in fixtures
  };

  return { project, snapshot };
}

/**
 * Get list of all available fixture types
 */
export function getAvailableFixtures(): Array<{
  type: FixtureType;
  name: string;
  description: string;
}> {
  return [
    { type: 'empty', name: 'Empty Project', description: 'Single empty track, no items' },
    { type: 'single-video', name: 'Single Video', description: 'One video clip on one track' },
    { type: 'single-audio', name: 'Single Audio', description: 'One audio clip on one track' },
    { type: 'single-image', name: 'Single Image', description: 'One image on one track' },
    { type: 'single-text', name: 'Single Text', description: 'One text item on one track' },
    { type: 'multi-track', name: 'Multi-Track', description: '3 tracks with video, text, shapes, and audio' },
    { type: 'with-transitions', name: 'With Transitions', description: 'Video clips with crossfade transitions' },
    { type: 'with-keyframes', name: 'With Keyframes', description: 'Animated items with keyframes' },
    { type: 'complex', name: 'Complex Project', description: '5 tracks, transitions, keyframes, markers, in/out points' },
    { type: 'stress-test', name: 'Stress Test', description: '10 tracks, 20 items each (200 total items)' },
  ];
}

/**
 * Generate all fixtures at once (useful for test suites)
 */
export function generateAllFixtures(options: FixtureOptions = {}): Map<FixtureType, FixtureResult> {
  const fixtures = new Map<FixtureType, FixtureResult>();

  for (const { type } of getAvailableFixtures()) {
    fixtures.set(type, generateFixture(type, options));
  }

  return fixtures;
}
