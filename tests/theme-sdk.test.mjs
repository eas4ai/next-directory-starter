import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

test('THM-001 typed tokens validate and render a custom theme', async () => {
  const { defineTheme, renderThemeCss, installedThemes } =
    await import('../src/lib/theme-sdk.ts');
  const { defaultThemePreset } = await import('../src/lib/theme.ts');
  assert.equal(typeof defineTheme, 'function');
  assert.equal(typeof renderThemeCss, 'function');
  assert.ok(installedThemes.studio, 'a custom example theme must be installed');
  const css = renderThemeCss(defaultThemePreset, 'studio', ':root');
  for (const token of ['--background:', '--foreground:', '--primary:',
    '--theme-page-width:', '--theme-space-section:', '--preset-body-font:',
    '--preset-shadow:']) assert.ok(css.includes(token), `${token} is missing`);
  assert.match(css, /data-mode="dark"/);
  const broken = structuredClone(installedThemes.studio);
  delete broken.light.primary;
  assert.throws(() => defineTheme(broken), /primary|token/i);
});

test('THM-002 authored inline CSS is absent and theme/template routes exist', () => {
  for (const path of sourceFiles('src')) {
    const code = readFileSync(path, 'utf8');
    assert.doesNotMatch(code, /<style(?:\s|>)/i, `${path} authors a style element`);
    assert.doesNotMatch(code, /\bstyle\s*=\s*(?:\{|["'])/i,
      `${path} authors a style attribute`);
  }
  assert.ok(existsSync('src/app/theme.css/route.ts'), 'theme stylesheet route is missing');
  assert.ok(existsSync('src/app/api/admin/theme/selection/route.ts'),
    'protected selection route is missing');
  const layout = readFileSync('src/app/layout.tsx', 'utf8');
  assert.match(layout, /<link\b[^>]*href=["']\/theme\.css["']/);
  assert.match(layout, /data-template=/);
});

test('THM-003 skill and example extensions are usable', () => {
  const skill = '.agents/skills/create-directory-theme/SKILL.md';
  assert.ok(existsSync(skill), 'agent skill is missing');
  const instructions = readFileSync(skill, 'utf8');
  assert.match(instructions, /^---\nname: create-directory-theme\ndescription: .+\n---\n/);
  for (const item of ['token', 'template', 'brand', 'preview', 'build']) {
    assert.match(instructions, new RegExp(item, 'i'), `${item} guidance is missing`);
  }
  assert.ok(existsSync('src/themes/studio.ts'), 'example theme is missing');
  assert.ok(existsSync('src/templates/editorial.css'), 'example template is missing');
});

test('THM-004 branding has protected settings and asset paths', () => {
  assert.ok(existsSync('src/lib/branding.ts'), 'brand settings are missing');
  assert.ok(existsSync('src/app/api/admin/branding/route.ts'), 'brand API is missing');
  assert.ok(existsSync('src/app/api/admin/branding/assets/route.ts'),
    'validated brand asset upload is missing');
  const card = readFileSync('src/lib/agent-cards.ts', 'utf8');
  assert.match(card, /getSiteConfig|branding/);
  assert.match(card, /theme|token|palette/i);
});
