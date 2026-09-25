import { describe, it, expect } from 'vitest';
import {
  clampViewStart,
  followViewStart,
  formatPlaybackRate,
  isTypingTarget,
  slicePeaks,
  stepPlaybackRate,
  stepZoom,
  viewSpan,
  zoomViewStart,
} from './playerView';

describe('stepPlaybackRate', () => {
  it('moves through the rate list and stops at both ends', () => {
    expect(stepPlaybackRate(1, 1)).toBe(1.25);
    expect(stepPlaybackRate(1, -1)).toBe(0.75);
    expect(stepPlaybackRate(2, 1)).toBe(2);
    expect(stepPlaybackRate(0.5, -1)).toBe(0.5);
  });

  it('treats an unknown rate as normal speed', () => {
    expect(stepPlaybackRate(1.1, 1)).toBe(1.25);
  });
});

describe('stepZoom', () => {
  it('moves through the zoom levels and stops at both ends', () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(4, -1)).toBe(2);
    expect(stepZoom(16, 1)).toBe(16);
    expect(stepZoom(1, -1)).toBe(1);
  });
});

describe('view window', () => {
  it('shows 1/zoom of the track', () => {
    expect(viewSpan(120, 1)).toBe(120);
    expect(viewSpan(120, 4)).toBe(30);
    expect(viewSpan(0, 4)).toBe(0);
  });

  it('keeps the whole view inside the track', () => {
    expect(clampViewStart(-5, 120, 4)).toBe(0);
    expect(clampViewStart(100, 120, 4)).toBe(90);
    expect(clampViewStart(50, 120, 4)).toBe(50);
    expect(clampViewStart(50, 120, 1)).toBe(0);
  });

  it('zooms around an anchor, keeping it at the same place on screen', () => {
    // Anchor at 60s is in the middle of the full view; after 4x zoom the 30s
    // view is centred on it.
    expect(zoomViewStart(120, 0, 1, 4, 60)).toBe(45);
    // Anchor a quarter into a 30s view (40..70 → 47.5); at 8x (15s) it stays a quarter in.
    expect(zoomViewStart(120, 40, 4, 8, 47.5)).toBe(43.75);
    // Zooming back out to 1x always shows the whole track.
    expect(zoomViewStart(120, 43.75, 8, 1, 47.5)).toBe(0);
  });

  it('follows the playhead page by page', () => {
    // Still visible: the view does not move.
    expect(followViewStart(30, 120, 4, 45)).toBe(30);
    // Past the right edge: jump so the playhead sits just after the left edge.
    expect(followViewStart(30, 120, 4, 61)).toBe(58);
    // Before the left edge (e.g. after seeking back).
    expect(followViewStart(30, 120, 4, 10)).toBe(7);
    // Near the end, the view is clamped to the track.
    expect(followViewStart(30, 120, 4, 119)).toBe(90);
  });
});

describe('slicePeaks', () => {
  const peaks = Array.from({ length: 100 }, (_, i) => i);

  it('returns the overview peaks under a time range', () => {
    expect(slicePeaks(peaks, 200, 50, 100)).toEqual(peaks.slice(25, 50));
  });

  it('always returns at least one peak', () => {
    expect(slicePeaks(peaks, 200, 199.9, 200)).toEqual([99]);
  });
});

describe('formatPlaybackRate', () => {
  it('uses the locale decimal separator', () => {
    expect(formatPlaybackRate(0.75, 'pt-PT')).toBe('0,75×');
    expect(formatPlaybackRate(1.5, 'en')).toBe('1.5×');
    expect(formatPlaybackRate(2, 'pt-PT')).toBe('2×');
  });
});

describe('isTypingTarget', () => {
  it('is true for text fields and editable content only', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not derive isContentEditable from the attribute.
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    expect(isTypingTarget(document.createElement('input'))).toBe(true);
    expect(isTypingTarget(document.createElement('textarea'))).toBe(true);
    expect(isTypingTarget(document.createElement('select'))).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
