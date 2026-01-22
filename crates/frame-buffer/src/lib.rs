//! High-performance frame buffer for video playback
//!
//! This module provides a ring buffer for decoded video frames,
//! enabling smooth playback by decoupling decode from display.
//!
//! Architecture:
//! ```text
//! WebCodecs Decoder → push_frame() → [Ring Buffer] → get_frame_for_time() → Display
//! ```

use wasm_bindgen::prelude::*;
use std::collections::VecDeque;

/// Initialize panic hook for better error messages in browser console
#[wasm_bindgen(start)]
pub fn init() {
    #[cfg(feature = "console_error_panic_hook")]
    console_error_panic_hook::set_once();
}

/// Frame metadata (actual pixel data stays in JS as VideoFrame)
#[wasm_bindgen]
#[derive(Clone, Debug)]
pub struct FrameInfo {
    /// Frame number in the video
    pub frame_number: u32,
    /// Presentation timestamp in milliseconds
    pub pts_ms: f64,
    /// Duration in milliseconds
    pub duration_ms: f64,
    /// Width in pixels
    pub width: u32,
    /// Height in pixels
    pub height: u32,
    /// JS handle ID (index into JS-side frame storage)
    pub js_handle: u32,
    /// Whether this is a keyframe
    pub is_keyframe: bool,
}

#[wasm_bindgen]
impl FrameInfo {
    #[wasm_bindgen(constructor)]
    pub fn new(
        frame_number: u32,
        pts_ms: f64,
        duration_ms: f64,
        width: u32,
        height: u32,
        js_handle: u32,
        is_keyframe: bool,
    ) -> Self {
        Self {
            frame_number,
            pts_ms,
            duration_ms,
            width,
            height,
            js_handle,
            is_keyframe,
        }
    }
}

/// Buffer state for monitoring
#[wasm_bindgen]
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BufferState {
    /// Buffer is empty, need to decode more
    Starving,
    /// Buffer has some frames but below target
    Low,
    /// Buffer is healthy
    Healthy,
    /// Buffer is full, can slow down decoding
    Full,
}

/// Statistics for monitoring playback health
#[wasm_bindgen]
#[derive(Clone, Debug, Default)]
pub struct BufferStats {
    /// Number of frames currently in buffer
    pub frame_count: u32,
    /// Buffer capacity
    pub capacity: u32,
    /// Frames dropped due to being too late
    pub frames_dropped: u32,
    /// Frames decoded total
    pub frames_decoded: u32,
    /// Frames displayed total
    pub frames_displayed: u32,
    /// Current buffer state
    state: BufferState,
    /// Estimated buffer duration in ms
    pub buffer_duration_ms: f64,
}

#[wasm_bindgen]
impl BufferStats {
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> BufferState {
        self.state
    }
}

impl Default for BufferState {
    fn default() -> Self {
        BufferState::Starving
    }
}

/// Ring buffer for video frames
#[wasm_bindgen]
pub struct FrameBuffer {
    /// Frame storage (metadata only, actual data in JS)
    frames: VecDeque<FrameInfo>,
    /// Maximum frames to buffer
    capacity: usize,
    /// Target buffer size for "healthy" state
    target_size: usize,
    /// Low water mark - below this triggers more decoding
    low_water_mark: usize,
    /// FPS for timing calculations
    fps: f64,
    /// Stats tracking
    stats: BufferStats,
    /// Last displayed frame number
    last_displayed_frame: Option<u32>,
    /// Playback start time (performance.now() when play started)
    playback_start_time: Option<f64>,
    /// Frame number at playback start
    playback_start_frame: u32,
}

#[wasm_bindgen]
impl FrameBuffer {
    /// Create a new frame buffer
    ///
    /// # Arguments
    /// * `capacity` - Maximum number of frames to buffer
    /// * `fps` - Video frame rate
    #[wasm_bindgen(constructor)]
    pub fn new(capacity: u32, fps: f64) -> Self {
        let capacity = capacity as usize;
        Self {
            frames: VecDeque::with_capacity(capacity),
            capacity,
            target_size: (capacity * 3) / 4, // 75% full is target
            low_water_mark: capacity / 4,     // 25% is low
            fps,
            stats: BufferStats {
                capacity: capacity as u32,
                ..Default::default()
            },
            last_displayed_frame: None,
            playback_start_time: None,
            playback_start_frame: 0,
        }
    }

    /// Push a decoded frame into the buffer
    ///
    /// Returns the JS handle of an evicted frame if buffer was full (so JS can release it)
    #[wasm_bindgen]
    pub fn push_frame(&mut self, frame: FrameInfo) -> Option<u32> {
        self.stats.frames_decoded += 1;

        // If buffer is full, evict oldest frame
        let evicted = if self.frames.len() >= self.capacity {
            self.frames.pop_front().map(|f| f.js_handle)
        } else {
            None
        };

        // Insert frame in sorted order by PTS
        let insert_pos = self.frames
            .iter()
            .position(|f| f.pts_ms > frame.pts_ms)
            .unwrap_or(self.frames.len());

        self.frames.insert(insert_pos, frame);
        self.update_state();

        evicted
    }

    /// Get the frame to display for the given time
    ///
    /// Returns None if no suitable frame is available
    #[wasm_bindgen]
    pub fn get_frame_for_time(&mut self, current_time_ms: f64) -> Option<FrameInfo> {
        if self.frames.is_empty() {
            return None;
        }

        // Find the frame with PTS closest to but not after current_time
        let mut best_idx = None;
        let mut best_pts = f64::NEG_INFINITY;

        for (idx, frame) in self.frames.iter().enumerate() {
            if frame.pts_ms <= current_time_ms && frame.pts_ms > best_pts {
                best_pts = frame.pts_ms;
                best_idx = Some(idx);
            }
        }

        if let Some(idx) = best_idx {
            let frame = self.frames[idx].clone();

            // Don't display the same frame twice
            if self.last_displayed_frame == Some(frame.frame_number) {
                return None;
            }

            // Remove frames that are too old (before this one)
            let mut dropped = 0;
            while self.frames.front().map(|f| f.frame_number) != Some(frame.frame_number) {
                if let Some(old) = self.frames.pop_front() {
                    // Frame was skipped/dropped
                    if old.frame_number != frame.frame_number {
                        dropped += 1;
                    }
                }
            }
            self.stats.frames_dropped += dropped;

            // Remove the frame we're returning
            self.frames.pop_front();

            self.last_displayed_frame = Some(frame.frame_number);
            self.stats.frames_displayed += 1;
            self.update_state();

            return Some(frame);
        }

        None
    }

    /// Get frame by exact frame number (for scrubbing)
    #[wasm_bindgen]
    pub fn get_frame_by_number(&self, frame_number: u32) -> Option<FrameInfo> {
        self.frames.iter()
            .find(|f| f.frame_number == frame_number)
            .cloned()
    }

    /// Start playback from a specific frame
    #[wasm_bindgen]
    pub fn start_playback(&mut self, start_frame: u32, current_time_ms: f64) {
        self.playback_start_time = Some(current_time_ms);
        self.playback_start_frame = start_frame;
        self.last_displayed_frame = None;
    }

    /// Stop playback
    #[wasm_bindgen]
    pub fn stop_playback(&mut self) {
        self.playback_start_time = None;
    }

    /// Get the presentation time for a given wall clock time
    #[wasm_bindgen]
    pub fn get_presentation_time(&self, current_time_ms: f64) -> f64 {
        match self.playback_start_time {
            Some(start) => {
                let elapsed = current_time_ms - start;
                let start_pts = (self.playback_start_frame as f64) * (1000.0 / self.fps);
                start_pts + elapsed
            }
            None => 0.0,
        }
    }

    /// Calculate which frame number should be displayed at a given time
    #[wasm_bindgen]
    pub fn get_target_frame(&self, current_time_ms: f64) -> u32 {
        match self.playback_start_time {
            Some(start) => {
                let elapsed = current_time_ms - start;
                let frames_elapsed = (elapsed * self.fps / 1000.0).floor() as u32;
                self.playback_start_frame + frames_elapsed
            }
            None => self.playback_start_frame,
        }
    }

    /// Clear all buffered frames, returns JS handles to release
    #[wasm_bindgen]
    pub fn clear(&mut self) -> Vec<u32> {
        let handles: Vec<u32> = self.frames.iter().map(|f| f.js_handle).collect();
        self.frames.clear();
        self.last_displayed_frame = None;
        self.update_state();
        handles
    }

    /// Get current buffer statistics
    #[wasm_bindgen]
    pub fn get_stats(&self) -> BufferStats {
        self.stats.clone()
    }

    /// Check if buffer needs more frames
    #[wasm_bindgen]
    pub fn needs_frames(&self) -> bool {
        self.frames.len() < self.target_size
    }

    /// Check if buffer is full
    #[wasm_bindgen]
    pub fn is_full(&self) -> bool {
        self.frames.len() >= self.capacity
    }

    /// Get the next frame number to decode
    #[wasm_bindgen]
    pub fn get_next_decode_frame(&self) -> u32 {
        self.frames.back()
            .map(|f| f.frame_number + 1)
            .unwrap_or(self.playback_start_frame)
    }

    /// Get earliest buffered frame number
    #[wasm_bindgen]
    pub fn get_earliest_frame(&self) -> Option<u32> {
        self.frames.front().map(|f| f.frame_number)
    }

    /// Get latest buffered frame number
    #[wasm_bindgen]
    pub fn get_latest_frame(&self) -> Option<u32> {
        self.frames.back().map(|f| f.frame_number)
    }

    /// Update buffer state based on current fill level
    fn update_state(&mut self) {
        let count = self.frames.len();
        self.stats.frame_count = count as u32;

        self.stats.state = if count == 0 {
            BufferState::Starving
        } else if count < self.low_water_mark {
            BufferState::Low
        } else if count >= self.capacity {
            BufferState::Full
        } else {
            BufferState::Healthy
        };

        // Calculate buffer duration
        if let (Some(first), Some(last)) = (self.frames.front(), self.frames.back()) {
            self.stats.buffer_duration_ms = last.pts_ms - first.pts_ms + last.duration_ms;
        } else {
            self.stats.buffer_duration_ms = 0.0;
        }
    }
}

/// Audio-video sync helper
#[wasm_bindgen]
pub struct AVSync {
    /// Target A/V sync threshold in ms (frames within this are considered synced)
    sync_threshold_ms: f64,
    /// Audio position in ms
    audio_time_ms: f64,
    /// Video position in ms
    video_time_ms: f64,
    /// Clock drift accumulator
    drift_ms: f64,
}

#[wasm_bindgen]
impl AVSync {
    #[wasm_bindgen(constructor)]
    pub fn new(sync_threshold_ms: f64) -> Self {
        Self {
            sync_threshold_ms,
            audio_time_ms: 0.0,
            video_time_ms: 0.0,
            drift_ms: 0.0,
        }
    }

    /// Update audio position
    #[wasm_bindgen]
    pub fn set_audio_time(&mut self, time_ms: f64) {
        self.audio_time_ms = time_ms;
        self.drift_ms = self.video_time_ms - self.audio_time_ms;
    }

    /// Update video position
    #[wasm_bindgen]
    pub fn set_video_time(&mut self, time_ms: f64) {
        self.video_time_ms = time_ms;
        self.drift_ms = self.video_time_ms - self.audio_time_ms;
    }

    /// Check if A/V is in sync
    #[wasm_bindgen]
    pub fn is_synced(&self) -> bool {
        self.drift_ms.abs() <= self.sync_threshold_ms
    }

    /// Get sync action recommendation
    /// Returns: -1 = drop video frame, 0 = display normally, 1 = repeat/wait
    #[wasm_bindgen]
    pub fn get_sync_action(&self) -> i32 {
        if self.drift_ms > self.sync_threshold_ms {
            // Video is ahead of audio, wait/repeat
            1
        } else if self.drift_ms < -self.sync_threshold_ms {
            // Video is behind audio, drop frame to catch up
            -1
        } else {
            // In sync, display normally
            0
        }
    }

    /// Get current drift in ms (positive = video ahead, negative = video behind)
    #[wasm_bindgen]
    pub fn get_drift_ms(&self) -> f64 {
        self.drift_ms
    }

    /// Reset sync state
    #[wasm_bindgen]
    pub fn reset(&mut self) {
        self.audio_time_ms = 0.0;
        self.video_time_ms = 0.0;
        self.drift_ms = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frame_buffer_push_and_get() {
        let mut buffer = FrameBuffer::new(10, 30.0);

        // Push some frames
        for i in 0..5 {
            let frame = FrameInfo::new(
                i,
                i as f64 * 33.33,
                33.33,
                1920,
                1080,
                i,
                i == 0,
            );
            buffer.push_frame(frame);
        }

        assert_eq!(buffer.get_stats().frame_count, 5);

        // Get frame for time
        buffer.start_playback(0, 0.0);
        let frame = buffer.get_frame_for_time(50.0);
        assert!(frame.is_some());
        assert_eq!(frame.unwrap().frame_number, 1);
    }

    #[test]
    fn test_buffer_states() {
        let mut buffer = FrameBuffer::new(10, 30.0);

        assert_eq!(buffer.get_stats().state, BufferState::Starving);

        // Add frames to reach different states
        for i in 0..3 {
            let frame = FrameInfo::new(i, i as f64 * 33.33, 33.33, 1920, 1080, i, false);
            buffer.push_frame(frame);
        }
        assert_eq!(buffer.get_stats().state, BufferState::Healthy);

        // Fill it up
        for i in 3..10 {
            let frame = FrameInfo::new(i, i as f64 * 33.33, 33.33, 1920, 1080, i, false);
            buffer.push_frame(frame);
        }
        assert_eq!(buffer.get_stats().state, BufferState::Full);
    }

    #[test]
    fn test_av_sync() {
        let mut sync = AVSync::new(40.0); // 40ms threshold

        sync.set_audio_time(1000.0);
        sync.set_video_time(1000.0);
        assert!(sync.is_synced());
        assert_eq!(sync.get_sync_action(), 0);

        // Video ahead
        sync.set_video_time(1100.0);
        assert!(!sync.is_synced());
        assert_eq!(sync.get_sync_action(), 1); // Wait

        // Video behind
        sync.set_video_time(900.0);
        assert!(!sync.is_synced());
        assert_eq!(sync.get_sync_action(), -1); // Drop
    }
}
