module.exports = {
  uiPort: 1880,
  flowFile: 'flows.json',
  credentialSecret: false,
  logging: { console: { level: 'info', metrics: false, audit: false } },
  ui: { path: 'ui' },
  editorTheme: { tours: false, projects: { enabled: false } },
};
