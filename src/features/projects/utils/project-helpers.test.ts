import { describe, it, expect } from 'vitest';
import { generateTemplateName } from './project-helpers';
import { PROJECT_TEMPLATES } from './validation';

describe('generateTemplateName', () => {
  describe('no existing names', () => {
    it('should return prefix with (1) when no existing names', () => {
      const result = generateTemplateName('YouTube', []);
      expect(result).toBe('YouTube (1)');
    });

    it('should work with different prefixes', () => {
      expect(generateTemplateName('TikTok', [])).toBe('TikTok (1)');
      expect(generateTemplateName('Instagram', [])).toBe('Instagram (1)');
    });
  });

  describe('sequential naming', () => {
    it('should increment from existing sequential names', () => {
      const existing = ['YouTube (1)', 'YouTube (2)', 'YouTube (3)'];
      const result = generateTemplateName('YouTube', existing);
      expect(result).toBe('YouTube (4)');
    });

    it('should handle single existing name', () => {
      const result = generateTemplateName('TikTok', ['TikTok (1)']);
      expect(result).toBe('TikTok (2)');
    });
  });

  describe('gaps in numbering', () => {
    it('should find max suffix even with gaps', () => {
      const existing = ['YouTube (1)', 'YouTube (3)', 'YouTube (5)'];
      const result = generateTemplateName('YouTube', existing);
      expect(result).toBe('YouTube (6)');
    });

    it('should handle non-sequential gaps', () => {
      const existing = ['YouTube (2)', 'YouTube (10)'];
      const result = generateTemplateName('YouTube', existing);
      expect(result).toBe('YouTube (11)');
    });
  });

  describe('non-matching names', () => {
    it('should ignore names with different prefixes', () => {
      const existing = ['TikTok (1)', 'TikTok (2)', 'Instagram (1)'];
      const result = generateTemplateName('YouTube', existing);
      expect(result).toBe('YouTube (1)');
    });

    it('should ignore malformed names', () => {
      const existing = ['YouTube 1', 'YouTube-2', 'YouTube[3]', 'YouTube (1)'];
      const result = generateTemplateName('YouTube', existing);
      expect(result).toBe('YouTube (2)');
    });

    it('should ignore names without parentheses', () => {
      const existing = ['YouTube', 'YouTube Copy', 'YouTube (1)'];
      const result = generateTemplateName('YouTube', existing);
      expect(result).toBe('YouTube (2)');
    });
  });

  describe('different prefixes', () => {
    it('should handle multi-word prefixes', () => {
      const existing = ['YouTube Shorts (1)', 'YouTube Shorts (2)'];
      const result = generateTemplateName('YouTube Shorts', existing);
      expect(result).toBe('YouTube Shorts (3)');
    });

    it('should handle prefixes with special characters', () => {
      const existing = ['Twitter/X (1)'];
      const result = generateTemplateName('Twitter/X', existing);
      expect(result).toBe('Twitter/X (2)');
    });

    it('should handle Instagram Reels prefix', () => {
      const existing = ['Instagram Reels (1)', 'Instagram Reels (2)'];
      const result = generateTemplateName('Instagram Reels', existing);
      expect(result).toBe('Instagram Reels (3)');
    });
  });

  describe('edge cases', () => {
    it('should handle large suffix numbers', () => {
      const existing = ['YouTube (999)'];
      const result = generateTemplateName('YouTube', existing);
      expect(result).toBe('YouTube (1000)');
    });

    it('should handle mixed case in existing names', () => {
      const existing = ['youtube (1)', 'YOUTUBE (2)'];
      const result = generateTemplateName('YouTube', existing);
      expect(result).toBe('YouTube (1)');
    });

    it('should handle whitespace variations in pattern', () => {
      const existing = ['YouTube(1)', 'YouTube (2)', 'YouTube  (3)'];
      const result = generateTemplateName('YouTube', existing);
      expect(result).toBe('YouTube (4)');
    });
  });
});

describe('PROJECT_TEMPLATES', () => {
  describe('structure validation', () => {
    it('should have exactly 6 templates', () => {
      expect(PROJECT_TEMPLATES).toHaveLength(6);
    });

    it('should have all required fields', () => {
      PROJECT_TEMPLATES.forEach((template) => {
        expect(template).toHaveProperty('id');
        expect(template).toHaveProperty('platform');
        expect(template).toHaveProperty('name');
        expect(template).toHaveProperty('namePrefix');
        expect(template).toHaveProperty('width');
        expect(template).toHaveProperty('height');
        expect(template).toHaveProperty('fps');
      });
    });
  });

  describe('field validation', () => {
    it('should have non-empty string fields', () => {
      PROJECT_TEMPLATES.forEach((template) => {
        expect(template.id).toBeTruthy();
        expect(typeof template.id).toBe('string');
        expect(template.platform).toBeTruthy();
        expect(typeof template.platform).toBe('string');
        expect(template.name).toBeTruthy();
        expect(typeof template.name).toBe('string');
        expect(template.namePrefix).toBeTruthy();
        expect(typeof template.namePrefix).toBe('string');
      });
    });

    it('should have valid width values', () => {
      PROJECT_TEMPLATES.forEach((template) => {
        expect(template.width).toBeGreaterThanOrEqual(320);
        expect(template.width).toBeLessThanOrEqual(7680);
        expect(Number.isInteger(template.width)).toBe(true);
      });
    });

    it('should have valid height values', () => {
      PROJECT_TEMPLATES.forEach((template) => {
        expect(template.height).toBeGreaterThanOrEqual(240);
        expect(template.height).toBeLessThanOrEqual(4320);
        expect(Number.isInteger(template.height)).toBe(true);
      });
    });

    it('should have valid FPS values', () => {
      const validFps = [24, 25, 30, 50, 60, 120, 240];
      PROJECT_TEMPLATES.forEach((template) => {
        expect(validFps).toContain(template.fps);
      });
    });
  });

  describe('uniqueness validation', () => {
    it('should have unique IDs', () => {
      const ids = PROJECT_TEMPLATES.map((t) => t.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have unique names', () => {
      const names = PROJECT_TEMPLATES.map((t) => t.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);
    });

    it('should have unique namePrefixes', () => {
      const prefixes = PROJECT_TEMPLATES.map((t) => t.namePrefix);
      const uniquePrefixes = new Set(prefixes);
      expect(uniquePrefixes.size).toBe(prefixes.length);
    });
  });

  describe('platform coverage', () => {
    it('should include YouTube templates', () => {
      const youtubeTemplates = PROJECT_TEMPLATES.filter(
        (t) => t.platform === 'YouTube'
      );
      expect(youtubeTemplates.length).toBeGreaterThan(0);
    });

    it('should include vertical (9:16) template', () => {
      const verticalTemplate = PROJECT_TEMPLATES.find(
        (t) => t.id === 'vertical-9-16'
      );
      expect(verticalTemplate).toBeDefined();
      expect(verticalTemplate?.width).toBe(1080);
      expect(verticalTemplate?.height).toBe(1920);
    });

    it('should include Instagram templates', () => {
      const instagramTemplates = PROJECT_TEMPLATES.filter(
        (t) => t.platform === 'Instagram'
      );
      expect(instagramTemplates.length).toBeGreaterThan(0);
    });

    it('should include Twitter/X template', () => {
      const twitterTemplate = PROJECT_TEMPLATES.find(
        (t) => t.platform === 'Twitter/X'
      );
      expect(twitterTemplate).toBeDefined();
    });

    it('should include LinkedIn template', () => {
      const linkedinTemplate = PROJECT_TEMPLATES.find(
        (t) => t.platform === 'LinkedIn'
      );
      expect(linkedinTemplate).toBeDefined();
    });
  });

  describe('specific template validation', () => {
    it('should have YouTube 1080p with correct dimensions', () => {
      const template = PROJECT_TEMPLATES.find((t) => t.id === 'youtube-1080p');
      expect(template).toBeDefined();
      expect(template?.width).toBe(1920);
      expect(template?.height).toBe(1080);
      expect(template?.fps).toBe(30);
    });

    it('should have vertical-9-16 with correct dimensions', () => {
      const template = PROJECT_TEMPLATES.find((t) => t.id === 'vertical-9-16');
      expect(template).toBeDefined();
      expect(template?.width).toBe(1080);
      expect(template?.height).toBe(1920);
      expect(template?.fps).toBe(30);
    });

    it('should have Instagram Square with 1:1 aspect ratio', () => {
      const template = PROJECT_TEMPLATES.find(
        (t) => t.id === 'instagram-square'
      );
      expect(template).toBeDefined();
      expect(template?.width).toBe(1080);
      expect(template?.height).toBe(1080);
    });

    it('should have Instagram Portrait with 4:5 aspect ratio', () => {
      const template = PROJECT_TEMPLATES.find(
        (t) => t.id === 'instagram-portrait'
      );
      expect(template).toBeDefined();
      expect(template?.width).toBe(1080);
      expect(template?.height).toBe(1350);
    });
  });
});
