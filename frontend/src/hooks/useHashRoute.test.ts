import { describe, it, expect } from 'vitest';
import { PROJECTS_ROUTE, isProjectsRoute, parseProjectRoute, projectRoute } from './useHashRoute';

describe('project routes', () => {
  it('round-trips a project page hash', () => {
    const hash = projectRoute('1b4e28ba-2fa1-11d2-883f-0016d3cca427');
    expect(hash).toBe('#/projects/1b4e28ba-2fa1-11d2-883f-0016d3cca427');
    expect(parseProjectRoute(hash)).toBe('1b4e28ba-2fa1-11d2-883f-0016d3cca427');
  });

  it('tells project pages from the rest of the app', () => {
    expect(isProjectsRoute(PROJECTS_ROUTE)).toBe(true);
    expect(isProjectsRoute('#/projects/abc')).toBe(true);
    expect(isProjectsRoute('#/projects/')).toBe(false);
    expect(isProjectsRoute('#/admin')).toBe(false);
    expect(isProjectsRoute('')).toBe(false);
    expect(parseProjectRoute('#/admin')).toBeNull();
  });
});
