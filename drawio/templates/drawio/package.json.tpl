{
  "name": "{{PROJECT_NAME}}",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "description": "{{PROJECT_TITLE}} —— drawio 系统架构图，由 layout-engineer 生成",
  "scripts": {
    "build": "node {{SKILL_REL}}/layout/scripts/build-tree.mjs --project .",
    "view": "node {{SKILL_REL}}/layout/scripts/positioning-viewer/serve.mjs --project .",
    "validate": "node {{SKILL_REL}}/layout/scripts/validate/run-all.mjs --project .",
    "render": "node {{SKILL_REL}}/drawio/scripts/serializers/index.mjs --project . --target drawio",
    "drawio": "node {{SKILL_REL}}/drawio/scripts/serializers/drawio.mjs --project .",
    "drawio-cli": "node {{SKILL_REL}}/drawio/scripts/serializers/drawio_cli.mjs --project . --format png,svg,pdf",
    "icons": "node {{SKILL_REL}}/drawio/scripts/icons/build-catalog.mjs --list",
    "confirm": "node {{SKILL_REL}}/layout/scripts/confirm.mjs --project .",
    "print-tree": "node {{SKILL_REL}}/layout/scripts/print-tree.mjs --project .",
    "impact": "node {{SKILL_REL}}/layout/scripts/indexer.mjs --project . --impact",
    "docs": "node {{SKILL_REL}}/layout/scripts/docgen.mjs --project ."
  }
}
