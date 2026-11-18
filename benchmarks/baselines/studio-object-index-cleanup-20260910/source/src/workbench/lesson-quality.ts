import {
  MATERIAL_DEMO_RECIPES,
  getMaterialDemoRecipe,
  getMaterialDemoStagePrimitives,
  materialDemoSpecimenPose,
  type MaterialDemoRecipe,
} from '../material-demos';
import {
  MATERIAL_LAB_CROSS_CATALOG,
  MATERIAL_LAB_FEATURED_IDS,
  WORKBENCH_LABS,
  catalogFiltersForLab,
  getMaterialDemoConceptBinding,
  getMaterialLabCatalogLabs,
  getWorkbenchLab,
  getWorkbenchLabAutoplay,
  materialLabCatalogCopy,
  materialLabCatalogSearchText,
  type WorkbenchLabDefinition,
} from './registry';

/**
 * Product AAA bar for a lesson someone can open and learn from.
 * Honesty beats spectacle: normalized / reduced-order, never fake kN/MPa/FEA.
 */
export const LESSON_AAA_GATES = [
  'physically-plausible',
  'immediately-playable',
  'teachable',
  'honest-units',
  'visual-fidelity',
] as const;

export type LessonAaaGate = (typeof LESSON_AAA_GATES)[number];

export type LessonAaaKind = 'recipe' | 'lab';

export type LessonAaaScore = {
  readonly id: string;
  readonly kind: LessonAaaKind;
  readonly title: string;
  readonly specimen: string;
  readonly gates: Readonly<Record<LessonAaaGate, boolean>>;
  readonly fails: readonly string[];
};

const FAKE_SI_CLAIM = /\b\d+(\.\d+)?\s*(kN|MPa|GPa|ksi|cal)\b|\bcalibrated FEA\b/i;
const HONEST_DISCLAIMER = /\bnot\b[\s\S]{0,80}\b(kN|MPa|GPa|ksi|calibrated|FEA|joule)/i;

function claimsFakeEngineeringUnits(text: string): boolean {
  if (HONEST_DISCLAIMER.test(text)) return false;
  return FAKE_SI_CLAIM.test(text);
}

function gateRecord(fails: readonly string[]): Readonly<Record<LessonAaaGate, boolean>> {
  const failed = new Set(fails.map((fail) => fail.slice(0, fail.indexOf(':')) as LessonAaaGate));
  return Object.freeze({
    'physically-plausible': !failed.has('physically-plausible'),
    'immediately-playable': !failed.has('immediately-playable'),
    teachable: !failed.has('teachable'),
    'honest-units': !failed.has('honest-units'),
    'visual-fidelity': !failed.has('visual-fidelity'),
  });
}

function pushFail(fails: string[], gate: LessonAaaGate, reason: string): void {
  fails.push(`${gate}: ${reason}`);
}

function catalogHasId(id: string): boolean {
  return getMaterialLabCatalogLabs().some((lab) => lab.id === id);
}

function gradeRecipe(recipe: MaterialDemoRecipe): LessonAaaScore {
  const fails: string[] = [];
  const pose = materialDemoSpecimenPose(recipe);
  const binding = getMaterialDemoConceptBinding(recipe.id);
  const labId = binding?.labId ?? null;
  const catalogId = labId ?? recipe.id;
  const stage = getMaterialDemoStagePrimitives(recipe.id);
  const copy = `${recipe.title}\n${recipe.specimen}\n${recipe.tagline}\n${recipe.objective}`;

  if (recipe.id === 'metal-notch-tear' && !recipe.notch) {
    pushFail(fails, 'physically-plausible', 'notch tear must seed a seam');
  }
  if (
    (recipe.id === 'metal-press-brake-v-bend' || recipe.id === 'metal-springback-fold')
    && !(recipe.holdThenUnloadSeconds && recipe.holdThenUnloadSeconds > 0)
  ) {
    pushFail(fails, 'physically-plausible', 'fold lessons must unload after the hold beat');
  }
  if (recipe.id === 'metal-press-brake-v-bend' && recipe.loadPattern !== 'line') {
    pushFail(fails, 'physically-plausible', 'metal fold must stay a line-load press-brake');
  }
  if (recipe.id === 'metal-square-punch-forming' && recipe.loadPattern !== 'center') {
    pushFail(fails, 'physically-plausible', 'ballistic dent must stay a compact center punch');
  }
  if (recipe.id === 'glass-laminated-stone-strike' && (recipe.crackStyle !== 'retained' || recipe.loadPattern !== 'offset')) {
    pushFail(fails, 'physically-plausible', 'glass impact must stay an off-center retained spiderweb');
  }
  if (recipe.id === 'concrete-flat-slab-punching' && recipe.crackStyle !== 'cone') {
    pushFail(fails, 'physically-plausible', 'concrete shear must stay a punching cone, not a blast');
  }
  if (recipe.kind === 'glass' && recipe.crackStyle === 'local') {
    pushFail(fails, 'physically-plausible', 'glass must crack, not dent');
  }
  if (MATERIAL_DEMO_RECIPES.some((other) => other.id !== recipe.id && other.title === recipe.title)) {
    pushFail(fails, 'teachable', 'title must uniquely name the lesson');
  }
  const featuredIndex = (MATERIAL_LAB_FEATURED_IDS as readonly string[]).indexOf(recipe.id);
  if (featuredIndex >= 0) {
    const signature = `${recipe.kind}|${recipe.loadPattern}|${recipe.crackStyle}|${recipe.fixtureStyle}|${recipe.boundary}`;
    for (const featuredId of MATERIAL_LAB_FEATURED_IDS) {
      if (featuredId === recipe.id) continue;
      const other = getMaterialDemoRecipe(featuredId);
      if (!other) continue;
      const otherSignature = `${other.kind}|${other.loadPattern}|${other.crackStyle}|${other.fixtureStyle}|${other.boundary}`;
      if (otherSignature === signature) {
        pushFail(fails, 'physically-plausible', 'featured lesson must stay distinct from other featured rows');
      }
    }
  }
  if (pose.upAxis !== 'Y') pushFail(fails, 'physically-plausible', 'must stay Y-up');
  if (recipe.kind === 'glass' && pose.orientation !== 'vertical') {
    pushFail(fails, 'physically-plausible', 'glass must stay a vertical pane');
  }
  if (recipe.kind === 'metal' && pose.orientation === 'horizontal' && pose.loadSign === 1) {
    pushFail(fails, 'physically-plausible', 'horizontal metal must not load toward +Y');
  }
  if (recipe.duration <= 0) pushFail(fails, 'immediately-playable', 'must publish a playable duration');
  if (!catalogHasId(catalogId)) pushFail(fails, 'immediately-playable', 'must appear in the Material Lab catalog');
  if (labId) {
    const playback = getWorkbenchLabAutoplay(labId);
    if (!playback?.autoPlay) pushFail(fails, 'immediately-playable', 'bound lab must autoplay');
  }
  if (!recipe.title.trim() || !recipe.specimen.trim()) {
    pushFail(fails, 'teachable', 'must bind a specimen title');
  }
  const catalogLab = getMaterialLabCatalogLabs().find((lab) => lab.id === catalogId);
  if (catalogLab && !materialLabCatalogSearchText(catalogLab).toLowerCase().includes(recipe.title.toLowerCase())) {
    pushFail(fails, 'teachable', 'catalog search must find the bound title');
  }
  if (!recipe.tagline.trim() || !recipe.objective.trim()) {
    pushFail(fails, 'teachable', 'must teach with a tagline and objective');
  }
  if (claimsFakeEngineeringUnits(copy)) {
    pushFail(fails, 'honest-units', 'must not claim fake kN/MPa/calibrated FEA');
  }
  if (recipe.camera.pitch < 0.08 || recipe.camera.pitch > 1.3 || recipe.camera.target[1] <= 0) {
    pushFail(fails, 'visual-fidelity', 'camera must stay above the Y-up specimen');
  }
  if (stage.length < 8) pushFail(fails, 'visual-fidelity', 'must stage a dressed lab cell');

  return Object.freeze({
    id: recipe.id,
    kind: 'recipe',
    title: recipe.title,
    specimen: recipe.specimen,
    gates: gateRecord(fails),
    fails: Object.freeze(fails),
  });
}

function gradeLab(lab: WorkbenchLabDefinition): LessonAaaScore {
  const fails: string[] = [];
  const copy = materialLabCatalogCopy(lab);
  const playback = getWorkbenchLabAutoplay(lab.id);
  const filters = catalogFiltersForLab(lab);
  const text = `${lab.title}\n${lab.shortName}\n${lab.description}\n${copy.title}\n${copy.specimen}`;

  if (!lab.description.trim()) pushFail(fails, 'physically-plausible', 'must describe the mechanism');
  if (lab.forceModes.length === 0) pushFail(fails, 'immediately-playable', 'must expose a force/action');
  if (!playback?.autoPlay) pushFail(fails, 'immediately-playable', 'must autoplay on open');
  if (!catalogHasId(lab.id)) pushFail(fails, 'immediately-playable', 'must appear in the Material Lab catalog');
  if (!copy.title.trim() || !copy.specimen.trim()) pushFail(fails, 'teachable', 'must bind a specimen title');
  if (filters.length < 2) pushFail(fails, 'teachable', 'must map to a catalog filter chip');
  if (claimsFakeEngineeringUnits(text)) {
    pushFail(fails, 'honest-units', 'must not claim fake kN/MPa/calibrated FEA');
  }
  if (!lab.fidelity.toLowerCase().includes('numerical') && lab.fidelity !== 'Rigid-body proxy' && lab.fidelity !== 'Independent numerical rigs') {
    pushFail(fails, 'honest-units', 'fidelity must stay a numerical/proxy claim');
  }
  if (!copy.title.trim()) pushFail(fails, 'visual-fidelity', 'viewport chrome must keep the bound title');

  return Object.freeze({
    id: lab.id,
    kind: 'lab',
    title: copy.title,
    specimen: copy.specimen,
    gates: gateRecord(fails),
    fails: Object.freeze(fails),
  });
}

/** One row per openable lesson: every recipe, plus labs that are not a recipe wrapper. */
export function listAaaLessons(): readonly { readonly id: string; readonly kind: LessonAaaKind }[] {
  const rows: Array<{ readonly id: string; readonly kind: LessonAaaKind }> = [];
  const recipeLabIds = new Set<string>();
  for (const recipe of MATERIAL_DEMO_RECIPES) {
    rows.push({ id: recipe.id, kind: 'recipe' });
    const labId = getMaterialDemoConceptBinding(recipe.id)?.labId;
    if (labId) recipeLabIds.add(labId);
  }
  for (const lab of WORKBENCH_LABS) {
    if (recipeLabIds.has(lab.id)) continue;
    rows.push({ id: lab.id, kind: 'lab' });
  }
  return Object.freeze(rows);
}

export function gradeAaaLesson(id: string): LessonAaaScore | null {
  const recipe = getMaterialDemoRecipe(id);
  if (recipe) return gradeRecipe(recipe);
  const lab = getWorkbenchLab(id);
  return lab ? gradeLab(lab) : null;
}

export function gradeAllAaaLessons(): readonly LessonAaaScore[] {
  return Object.freeze(listAaaLessons().map((lesson) => {
    const score = gradeAaaLesson(lesson.id);
    if (!score) throw new Error(`AAA lesson '${lesson.id}' could not be graded.`);
    return score;
  }));
}

export function failingAaaLessons(): readonly LessonAaaScore[] {
  return Object.freeze(gradeAllAaaLessons().filter((score) => score.fails.length > 0));
}

export function featuredLessonIds(): readonly string[] {
  return Object.freeze([
    ...MATERIAL_LAB_FEATURED_IDS,
    ...MATERIAL_LAB_CROSS_CATALOG.map((row) => row.labId),
  ]);
}
