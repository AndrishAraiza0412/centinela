// Modelos que se pueden elegir al lanzar (servidor valida, panel muestra). `claude --model`
// acepta el alias (la última versión de la familia) o el id exacto.
export const MODEL_GROUPS = [
  ['Lo más reciente', [['opus', 'Opus (el más reciente)'], ['sonnet', 'Sonnet (el más reciente)'], ['haiku', 'Haiku (el más reciente)']]],
  ['Fable', [['claude-fable-5-1', 'Fable 5.1'], ['claude-fable-5', 'Fable 5']]],
  ['Opus', [['claude-opus-5-5', 'Opus 5.5'], ['claude-opus-5', 'Opus 5'], ['claude-opus-4-8', 'Opus 4.8'], ['claude-opus-4-7', 'Opus 4.7'], ['claude-opus-4-6', 'Opus 4.6']]],
  ['Sonnet', [['claude-sonnet-5-5', 'Sonnet 5.5'], ['claude-sonnet-5', 'Sonnet 5'], ['claude-sonnet-4-6', 'Sonnet 4.6']]],
  ['Haiku', [['claude-haiku-5-5', 'Haiku 5.5'], ['claude-haiku-4-5', 'Haiku 4.5']]],
];

// '' = el modelo por defecto de la configuración del usuario.
export const MODELS = ['', ...MODEL_GROUPS.flatMap(([, models]) => models.map(([id]) => id))];
