/**
 * A calibrated library of engineering materials with sources. SI units throughout.
 * See docs/MATERIALS.md for the table, the citations and how to add a material.
 *
 * Every property value carries the conditions it holds for (temperature, grade, temper, moisture), the
 * figure exactly as it was read in the source (`read`), how it was converted or derived when it was not
 * read in SI (`derived`), a range where the sources disagree or state one, and the id of the source it
 * came from. A value that no opened source gave is marked `source: 'unverified'` with a reason; the
 * helpers refuse such a value unless `allowUnverified` is set, so that nothing unsourced enters a solver
 * by accident.
 *
 * The helpers build the inputs of the solvers from an entry: `solidMaterial` (solid.ts),
 * `fractureLaw` (solid-fracture.ts), `heatMaterial` (heat.ts), `grainMaterial` (granular.ts) and
 * `contactPair` / `rigidMaterial` for the rigid world's friction and restitution.
 *
 * Nothing here runs a solver; the module only imports types.
 */
import {EngineError} from './contracts.ts';
import type {SolidMaterial} from './solid.ts';
import type {FractureLaw, FractureModel} from './solid-fracture.ts';
import type {HeatMaterial} from './heat.ts';
import type {GranularMaterial} from './granular.ts';

export const MATERIAL_LIBRARY_ID = 'box3d-materials';
/** Semver of the data: a changed value is a minor release, a removed material or property a major one. */
export const MATERIAL_LIBRARY_VERSION = '1.2.0';
/** The date the sources were opened and read. */
export const MATERIAL_SOURCES_ACCESSED = '2026-11-12';

export type MaterialSourceKind =
  | 'standard'        // a standard, or a design aid that tabulates a standard's clauses
  | 'government'      // a government laboratory or agency report or database
  | 'manufacturer'    // a producer's or distributor's datasheet
  | 'peer-reviewed'   // a journal or conference paper
  | 'textbook'        // an open textbook or university course material
  | 'last-resort';    // an engineering data website, used only where nothing better was found

export interface MaterialSource {
  readonly id: string;
  readonly title: string;
  readonly author: string;
  readonly kind: MaterialSourceKind;
  readonly url: string;
  readonly note?: string;
}

/** Every source a value was read from. Each URL was opened on MATERIAL_SOURCES_ACCESSED. */
export const MATERIAL_SOURCES: Readonly<Record<string, MaterialSource>> = deepFreeze({
  'ec3-design-properties': {id: 'ec3-design-properties', kind: 'standard', author: 'Eurocode Applied (design aid)',
    title: 'Eurocode 3 Table of design material properties for structural steel (EN 1993-1-1:2005+AC2:2009, 3.2.1 and 3.2.6)',
    url: 'https://cdn.eurocodeapplied.com/design/en1993/steel-design-properties',
    note: 'A design aid that tabulates the clauses of EN 1993-1-1; the standard itself was not opened.'},
  'dlubal-en1993-1-2': {id: 'dlubal-en1993-1-2', kind: 'standard', author: 'Dlubal Software (knowledge base)',
    title: 'Structural Fire Design According to DIN EN 1993-1-2 (Thermal Material Properties)',
    url: 'https://www.dlubal.com/en-US/support-and-learning/support/knowledge-base/001496',
    note: 'Quotes the EN 1993-1-2:2005+AC:2009 formulas for carbon steel; the standard itself was not opened.'},
  'asm-304': {id: 'asm-304', kind: 'manufacturer', author: 'Aerospace Specification Metals (ASM material data sheet)',
    title: 'AISI Type 304 Stainless Steel', url: 'https://www.aerospacemetals.com/wp-content/uploads/2023/07/AISI-Type-304-Stainless-Steel.pdf'},
  'asm-6061-t6': {id: 'asm-6061-t6', kind: 'manufacturer', author: 'Aerospace Specification Metals (ASM material data sheet; data from the Aluminum Association, "AA; Typical", not for design)',
    title: 'Aluminum 6061-T6; 6061-T651', url: 'https://www.aerospacemetals.com/wp-content/uploads/2023/06/Aluminum-6061-T6-6061-T651.pdf'},
  'nist-cryo-6061': {id: 'nist-cryo-6061', kind: 'government', author: 'NIST Cryogenic Technologies Group',
    title: 'Material Properties: 6061-T6 Aluminum (UNS A96061)', url: 'https://trc.nist.gov/cryogenics/materials/6061%20Aluminum/6061_T6Aluminum_rev.htm',
    note: 'Curve fits for 1 to 300 K; the values here are the fits evaluated at 293.15 K (the Young\'s modulus fit is stated to 295 K).'},
  'cda-c11000': {id: 'cda-c11000', kind: 'manufacturer', author: 'Copper Development Association',
    title: 'C11000 Electrolytic Tough Pitch (ETP) copper: properties', url: 'https://alloys.copper.org/alloy/C11000'},
  'ke-en1561': {id: 'ke-en1561', kind: 'manufacturer', author: 'Kemptener Eisengießerei Adam Hönig AG',
    title: 'KE factory standard based on EN 1561, cast iron with lamellar graphite (material table)', url: 'https://www.ke-ag.de/wp-content/uploads/2018/10/Werkstofftabelle-GJLver2018.pdf'},
  'ct-soda-lime': {id: 'ct-soda-lime', kind: 'manufacturer', author: 'Continental Trade Sp. z o.o.',
    title: 'Soda-lime glass properties (information sheet)', url: 'https://www.continentaltrade.com.pl/en/download/WhfvdEYg1jSqsBXM5x9dRJnJfIPvp1gO/soda-lime-glass-properties.pdf'},
  'salem-jenkins-2018': {id: 'salem-jenkins-2018', kind: 'peer-reviewed', author: 'J. A. Salem (NASA Glenn), M. G. Jenkins',
    title: 'Applying ASTM International C1421 to glasses and optical ceramics, Ceramic Engineering and Science Proceedings (42nd ICACC), 2018, Table 4',
    url: 'https://ntrs.nasa.gov/api/citations/20180005170/downloads/20180005170.pdf'},
  'ec2-design-properties': {id: 'ec2-design-properties', kind: 'standard', author: 'Eurocode Applied (design aid)',
    title: 'Table of concrete design properties (fcd, fctm, Ecm, fctd), Eurocode 2 (EN 1992-1-1:2004+AC2:2010, 3.1.2 and 3.1.3)',
    url: 'https://eurocodeapplied.com/design/en1992/concrete-design-properties',
    note: 'A design aid that tabulates EN 1992-1-1 Table 3.1; the standard itself was not opened.'},
  'en1992-1-2': {id: 'en1992-1-2', kind: 'standard', author: 'CEN (BS EN 1992-1-2:2004)',
    title: 'Eurocode 2: Design of concrete structures, Part 1-2: Structural fire design, clauses 3.3.2 and 3.3.3',
    url: 'https://www.phd.eng.br/wp-content/uploads/2015/12/en.1992.1.2.2004.pdf'},
  'ucrl-15151': {id: 'ucrl-15151', kind: 'government', author: 'Willard Owens Associates for Lawrence Livermore Laboratory',
    title: 'UCRL-15151, Geoscience parameter data base handbook: granites and basalts, Table 1-5 "Intact properties of Barre Granite" (from Office of Waste Isolation, 1978)',
    url: 'https://www.osti.gov/servlets/purl/5719576', note: 'A scanned report; the heat capacity and the expansion coefficient in the same table are not legible and were not used.'},
  'wood-handbook-ch5': {id: 'wood-handbook-ch5', kind: 'government', author: 'D. E. Kretschmann, USDA Forest Products Laboratory',
    title: 'Mechanical Properties of Wood, chapter 5 of the Wood Handbook, FPL-GTR-190 (2010), Tables 5-1, 5-2 and 5-3a',
    url: 'https://research.fs.usda.gov/download/treesearch/37427.pdf'},
  'wood-handbook-ch4': {id: 'wood-handbook-ch4', kind: 'government', author: 'S. V. Glass, S. L. Zelinka, USDA Forest Products Laboratory',
    title: 'Moisture Relations and Physical Properties of Wood, chapter 4 of the Wood Handbook, FPL-GTR-190 (2010), equations 4-15 to 4-18',
    url: 'https://research.fs.usda.gov/download/treesearch/37428.pdf'},
  'evonik-plexiglas': {id: 'evonik-plexiglas', kind: 'manufacturer', author: 'Evonik Industries AG',
    title: 'Technical Information PLEXIGLAS GS/XT (211-1), September 2011', url: 'https://igepa.ee/wp-content/uploads/2017/06/211-1-PLEXIGLAS-GS-XT-en.pdf'},
  'basf-terluran-gp35': {id: 'basf-terluran-gp35', kind: 'manufacturer', author: 'BASF SE',
    title: 'Product Information Terluran GP-35 (ABS)', url: 'https://static.chipdip.ru/lib/299/DOC015299117.pdf'},
  'dupont-zytel-101l': {id: 'dupont-zytel-101l', kind: 'manufacturer', author: 'DuPont',
    title: 'Zytel 101L NC010 nylon resin (PA66) datasheet', url: 'https://quickparts.com/wp-content/uploads/2023/04/zytel%C2%AE-101l-nc010-gb.pdf'},
  'proplas-ptfe': {id: 'proplas-ptfe', kind: 'manufacturer', author: 'Professional Plastics (distributor)',
    title: 'Typical properties of PTFE', url: 'https://www.professionalplastics.com/professionalplastics/content/downloads/Teflon_PTFE.pdf'},
  'nbs-rp717': {id: 'nbs-rp717', kind: 'government', author: 'N. Bekkedahl, National Bureau of Standards',
    title: 'Forms of rubber as indicated by temperature-volume relationship, J. Res. NBS 13 (1934) 411, RP717',
    url: 'https://nvlpubs.nist.gov/nistpubs/jres/13/jresv13n3p411_A2b.pdf'},
  'nbs-rp844': {id: 'nbs-rp844', kind: 'government', author: 'N. Bekkedahl, H. Matheson, National Bureau of Standards',
    title: 'Heat capacity, entropy, and free energy of rubber hydrocarbon, J. Res. NBS 15 (1935) 503, RP844',
    url: 'https://nvlpubs.nist.gov/nistpubs/jres/15/jresv15n5p503_A1b.pdf'},
  'wood-1977-rubber': {id: 'wood-1977-rubber', kind: 'peer-reviewed', author: 'L. A. Wood, National Bureau of Standards',
    title: 'Uniaxial Extension and Compression in Stress-Strain Relations of Rubber, J. Res. NBS 82 (1977) 57-63, doi:10.6028/jres.082.005',
    url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC6751957'},
  'schulson-renshaw-2022': {id: 'schulson-renshaw-2022', kind: 'peer-reviewed', author: 'E. M. Schulson, C. E. Renshaw',
    title: 'Fracture, Friction, and Permeability of Ice, Annu. Rev. Earth Planet. Sci. 50 (2022) 323-343', url: 'https://par.nsf.gov/servlets/purl/10334531'},
  'etb-ice': {id: 'etb-ice', kind: 'last-resort', author: 'The Engineering ToolBox',
    title: 'Ice - Thermal Properties', url: 'https://www.engineeringtoolbox.com/ice-thermal-properties-d_576.html'},
  'nist-webbook-water': {id: 'nist-webbook-water', kind: 'government', author: 'NIST Chemistry WebBook, SRD 69 (E. W. Lemmon, M. O. McLinden, D. G. Friend)',
    title: 'Thermophysical Properties of Fluid Systems: water, isobar 0.101325 MPa, 293.15 K',
    url: 'https://webbook.nist.gov/cgi/fluid.cgi?Action=Data&Wide=on&ID=C7732185&Type=IsoBar&Digits=6&P=0.101325&THigh=293.15&TLow=293.15&TInc=1&RefState=DEF&TUnit=K&PUnit=MPa&DUnit=kg%2Fm3&HUnit=kJ%2Fkg&WUnit=m%2Fs&VisUnit=Pa*s&STUnit=N%2Fm'},
  'segur-oberstar-1951': {id: 'segur-oberstar-1951', kind: 'peer-reviewed', author: 'J. B. Segur, H. E. Oberstar',
    title: 'Viscosity of Glycerol and Its Aqueous Solutions, Ind. Eng. Chem. 43 (1951) 2117-2120, doi:10.1021/ie50501a040, Table V',
    url: 'https://faculty.ksu.edu.sa/sites/default/files/viscocity_of_glycerol.pdf', note: 'A scanned copy of the journal article.'},
  'volk-kahler-2018': {id: 'volk-kahler-2018', kind: 'peer-reviewed', author: 'A. Volk, C. J. Kähler (supplementary material), tabulating N. Bosart and A. O. Snoddy (1928)',
    title: 'Density model for aqueous glycerol solutions, Exp. Fluids 59 (2018) 75, doi:10.1007/s00348-018-2527-y, Electronic Supplementary Material 2, Table 1 "Measured densities of aqueous glycerol solutions (Bosart and Snoddy 1928)"',
    url: 'https://media.springernature.com/original/springer-static/esm/art%3A10.1007%2Fs00348-018-2527-y/MediaObjects/348_2018_2527_MOESM2_ESM.pdf'},
  'brock-2008': {id: 'brock-2008', kind: 'peer-reviewed', author: 'J. Brock, M. R. Nogueira, C. Zakrzevski, F. de Castilhos Corazza, M. L. Corazza, J. V. de Oliveira',
    title: 'Determinação experimental da viscosidade e condutividade térmica de óleos vegetais (Experimental measurements of viscosity and thermal conductivity of vegetable oils), Ciênc. Tecnol. Aliment. 28 (2008) 564-570, Tables 2 and 3',
    url: 'https://www.redalyc.org/pdf/3959/395940088010.pdf'},
  'rodriguez-navarro-2022': {id: 'rodriguez-navarro-2022', kind: 'peer-reviewed', author: 'H. Rodriguez-Navarro, D. Vivanco-Pezantes',
    title: 'Influence of temperature on the rheological behavior of industrialized honey, Agroindustrial Science 12 (2022) 7-14, doi:10.17268/agroind.sci.2022.01.01',
    url: 'https://revistas.unitru.edu.pe/index.php/agroindscience/article/download/4359/6544?inline=1'},
  'cengel-a9-air': {id: 'cengel-a9-air', kind: 'textbook', author: 'Y. A. Çengel, Table A-9, as posted by J. M. Cimbala for Penn State ME 420',
    title: 'Table A-9: Properties of air at 1 atm pressure', url: 'https://www.me.psu.edu/cimbala/me420/Links/Table_A_9_CC_Properties_of_Air.pdf'},
  'tang-2019': {id: 'tang-2019', kind: 'peer-reviewed', author: 'H. Tang, R. Song, Y. Dong, X. Song',
    title: 'Measurement of Restitution and Friction Coefficients for Granular Particles and Discrete Element Simulation for the Tests of Glass Beads, Materials 12 (2019) 3170, doi:10.3390/ma12193170, Tables 3 and 5',
    url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6803946/fullTextXML'},
  'sandeep-2018': {id: 'sandeep-2018', kind: 'peer-reviewed', author: 'C. S. Sandeep, K. Senetakis',
    title: 'Effect of Young\'s Modulus and Surface Roughness on the Inter-Particle Friction of Granular Materials, Materials 11 (2018) 217, doi:10.3390/ma11020217, Table 1',
    url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC5848914/fullTextXML'},
  'sandeep-2020': {id: 'sandeep-2020', kind: 'peer-reviewed', author: 'C. S. Sandeep, L. Luo, K. Senetakis',
    title: 'Effect of Grain Size and Surface Roughness on the Normal Coefficient of Restitution of Single Grains, Materials 13 (2020) 814, doi:10.3390/ma13040814, Tables 1 and 2',
    url: 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC7079616/fullTextXML'},
  'webmineral-quartz': {id: 'webmineral-quartz', kind: 'last-resort', author: 'Webmineral (D. Barthelmy)',
    title: 'Quartz Mineral Data', url: 'https://www.webmineral.com/data/Quartz.shtml'},
  'openstax-up1': {id: 'openstax-up1', kind: 'textbook', author: 'OpenStax (Rice University), University Physics Volume 1',
    title: '6.2 Friction, Table 6.1 "Approximate Coefficients of Static and Kinetic Friction"', url: 'https://openstax.org/books/university-physics-volume-1/pages/6-2-friction',
    note: 'The text states that the values are approximate, to one or two digits.'},
  'etb-friction': {id: 'etb-friction', kind: 'last-resort', author: 'The Engineering ToolBox',
    title: 'Friction and Friction Coefficients for various Materials', url: 'https://www.engineeringtoolbox.com/friction-coefficients-d_778.html',
    note: 'Gives no primary reference for its rows.'},
  'zou-2024': {id: 'zou-2024', kind: 'peer-reviewed', author: 'Z. Zou et al.',
    title: 'Experimental study of the restitution coefficient of spherical particles, J. Phys.: Conf. Ser. 2730 (2024) 012008, Table 1',
    url: 'https://iopscience.iop.org/article/10.1088/1742-6596/2730/1/012008/pdf'},
  'schott-borofloat-33': {id: 'schott-borofloat-33', kind: 'manufacturer', author: 'SCHOTT AG (distributed by Edmund Optics)',
    title: 'BOROFLOAT 33 - Technical Data (optical properties datasheet, 140827_schott_b33_opt_en)', url: 'https://www.edmundoptics.com/ViewDocument/schott-borofloat-technical-data-sheet-english.pdf'},
  'agc-stratobel-pvb': {id: 'agc-stratobel-pvb', kind: 'manufacturer', author: 'AGC Glass Europe (H. Lefèvre)',
    title: 'Material properties of PVB interlayers, Stratobel and Stratobel Strong laminated glass, 20 July 2022', url: 'https://www.agc-yourglass.com/sites/default/files/2022-10/Material%20Properties%20of%20PVB%200722_EN_0.pdf',
    note: 'Relaxation moduli for load resistance design (EN 16612 / EN 16613); the shortest duration tabulated for standard PVB is 3 s.'},
} satisfies Record<string, MaterialSource>);

export type MaterialPropertyName =
  | 'density' | 'youngModulus' | 'poissonRatio' | 'shearModulus'
  | 'yieldStrength' | 'tensileStrength' | 'compressiveStrength' | 'flexuralStrength'
  | 'fractureToughness' | 'fractureEnergy'
  | 'thermalConductivity' | 'specificHeat' | 'thermalExpansion'
  | 'viscosity' | 'soundSpeed';

/** The SI unit of each property. */
export const MATERIAL_PROPERTY_UNITS: Readonly<Record<MaterialPropertyName, string>> = Object.freeze({
  density: 'kg/m^3', youngModulus: 'Pa', poissonRatio: '1', shearModulus: 'Pa',
  yieldStrength: 'Pa', tensileStrength: 'Pa', compressiveStrength: 'Pa', flexuralStrength: 'Pa',
  fractureToughness: 'Pa m^0.5', fractureEnergy: 'J/m^2',
  thermalConductivity: 'W/(m K)', specificHeat: 'J/(kg K)', thermalExpansion: '1/K',
  viscosity: 'Pa s', soundSpeed: 'm/s',
});

export interface MaterialValue {
  /** The value in SI units (MATERIAL_PROPERTY_UNITS). */
  readonly value: number;
  /** Low and high ends where the sources disagree or one states a range. */
  readonly range?: readonly [number, number];
  /** Plus or minus this much (one standard deviation, or the stated scatter), in SI units. */
  readonly uncertainty?: number;
  /** Temperature, grade, temper, moisture, orientation, test method. */
  readonly conditions: string;
  /** A MATERIAL_SOURCES id, or 'unverified'. */
  readonly source: string;
  /** Additional sources that gave the range. */
  readonly also?: readonly string[];
  /** The figure exactly as read in the source, with its unit. Empty for an unverified value. */
  readonly read: string;
  /** How the SI value follows from what was read, when it is not the same number. */
  readonly derived?: string;
  /** Why a value is unverified. */
  readonly reason?: string;
}

export type MaterialCategory = 'metal' | 'glass' | 'stone' | 'concrete' | 'wood' | 'polymer' | 'elastomer' | 'ice' | 'fluid' | 'granular';

export interface MaterialEntry {
  readonly id: string;
  readonly name: string;
  readonly category: MaterialCategory;
  /** Grade, temper, species, the conditions that hold for the whole entry. */
  readonly grade: string;
  /** False for wood: the elastic values are along the grain and the shear modulus is G_LR. */
  readonly isotropic: boolean;
  readonly properties: Readonly<Partial<Record<MaterialPropertyName, MaterialValue>>>;
  /** Known disagreements inside the entry, kept as the sources state them. */
  readonly flags?: readonly string[];
  readonly notes?: readonly string[];
}

export type ContactCondition = 'dry' | 'lubricated' | 'wet';

export interface ContactPairEntry {
  readonly a: string;
  readonly b: string;
  readonly condition: ContactCondition;
  /** Coefficient of static friction. */
  readonly staticFriction?: MaterialValue;
  /** Coefficient of kinetic (sliding) friction. */
  readonly kineticFriction?: MaterialValue;
  /** A coefficient the source does not call static or kinetic. */
  readonly friction?: MaterialValue;
  /** Normal coefficient of restitution, with the impact speed in its conditions and in `impactSpeed`. */
  readonly restitution?: MaterialValue;
  /** Impact speeds, m/s, at which the restitution was measured; null when the source does not state them. */
  readonly impactSpeed?: readonly [number, number] | null;
}

const UNVERIFIED = 'unverified';
const CARRIED = 'No source was opened for this value. It is the scene editor\'s earlier typical value, written from memory (docs/SCENE_EDITOR.md before the library), kept so that the editor keeps a value for it.';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

type V = MaterialValue;
const v = (value: number, source: string, read: string, conditions: string, extra: Partial<V> = {}): V => ({value, source, read, conditions, ...extra});
const unverified = (value: number, conditions: string, reason: string, extra: Partial<V> = {}): V => ({value, source: UNVERIFIED, read: '', conditions, reason, ...extra});

const KSI = 6.894757e6, PSI = 6894.757;

const steelCommon = (grade: string): Partial<Record<MaterialPropertyName, V>> => ({
  density: v(7850, 'ec3-design-properties', 'rho ≈ 7850 kg/m3', `${grade}, EN 1993-1-1 3.2.6 design value`),
  youngModulus: v(210e9, 'ec3-design-properties', 'E = 210000 MPa', `${grade}, EN 1993-1-1 3.2.6`),
  poissonRatio: v(0.3, 'ec3-design-properties', 'nu = 0.30', `${grade}, elastic range, EN 1993-1-1 3.2.6`),
  shearModulus: v(81e9, 'ec3-design-properties', 'G = E / [2 (1 + nu)] ≈ 81000 MPa', `${grade}, EN 1993-1-1 3.2.6`),
  thermalExpansion: v(12e-6, 'ec3-design-properties', 'alpha = 12 x 10^-6 1/K', `${grade}, EN 1993-1-1 3.2.6, for T <= 100 °C`),
  thermalConductivity: v(53.334, 'dlubal-en1993-1-2', 'lambda_a = 54 - 3.33 x 10^-2 theta_a W/(m K), 20 °C <= theta_a < 800 °C', 'carbon steel at 20 °C, EN 1993-1-2',
    {derived: 'evaluated at theta_a = 20 °C'}),
  specificHeat: v(439.8, 'dlubal-en1993-1-2', 'c_a = 425 + 7.73 x 10^-1 theta_a - 1.69 x 10^-3 theta_a^2 + 2.22 x 10^-6 theta_a^3 J/(kg K), 20 °C <= theta_a < 600 °C',
    'carbon steel at 20 °C, EN 1993-1-2', {derived: 'evaluated at theta_a = 20 °C: 425 + 15.46 - 0.676 + 0.018'}),
});

/** The library's materials, by id. */
export const MATERIALS: Readonly<Record<string, MaterialEntry>> = deepFreeze({
  'structural-steel-s355': {id: 'structural-steel-s355', name: 'Structural steel S355', category: 'metal', grade: 'EN 10025-2 S355, thickness up to 40 mm', isotropic: true,
    properties: {...steelCommon('S355'),
      yieldStrength: v(355e6, 'ec3-design-properties', 'f_y = 355 MPa', 'S355, EN 10025-2, t <= 40 mm (nominal)'),
      tensileStrength: v(490e6, 'ec3-design-properties', 'f_u = 490 MPa', 'S355, EN 10025-2, t <= 40 mm (nominal)')},
    notes: ['No fracture toughness: none was found in an opened source; structural steel is ductile at room temperature and its toughness depends on the grade\'s Charpy class.']},
  'structural-steel-s235': {id: 'structural-steel-s235', name: 'Structural steel S235', category: 'metal', grade: 'EN 10025-2 S235, thickness up to 40 mm', isotropic: true,
    properties: {...steelCommon('S235'),
      yieldStrength: v(235e6, 'ec3-design-properties', 'f_y = 235 MPa', 'S235, EN 10025-2, t <= 40 mm (nominal)'),
      tensileStrength: v(360e6, 'ec3-design-properties', 'f_u = 360 MPa', 'S235, EN 10025-2, t <= 40 mm (nominal)')}},
  'stainless-304': {id: 'stainless-304', name: 'Stainless steel 304', category: 'metal', grade: 'AISI 304 (UNS S30400), annealed', isotropic: true,
    properties: {
      density: v(8000, 'asm-304', '8 g/cc', 'room temperature'),
      youngModulus: v(196.5e9, 'asm-304', '193 - 200 GPa', 'room temperature', {range: [193e9, 200e9], derived: 'middle of the stated range'}),
      poissonRatio: v(0.29, 'asm-304', '0.29', 'room temperature'),
      shearModulus: v(86e9, 'asm-304', '86 GPa', 'room temperature'),
      yieldStrength: v(215e6, 'asm-304', '215 MPa at 0.2% offset', 'annealed, room temperature'),
      tensileStrength: v(505e6, 'asm-304', '505 MPa', 'annealed, room temperature'),
      thermalConductivity: v(16.2, 'asm-304', '16.2 W/m-K at 0-100 °C', '0 to 100 °C'),
      specificHeat: v(500, 'asm-304', '0.5 J/g-°C from 0-100 °C', '0 to 100 °C'),
      thermalExpansion: v(17.3e-6, 'asm-304', '17.3 µm/m-°C, from 0-100 °C', 'mean, 0 to 100 °C')},
    flags: ['The sheet\'s shear modulus, 86 GPa, is 11% to 15% above E / (2 (1 + nu)) = 74.8 to 77.5 GPa from its own E and nu. Both are kept as stated; solidMaterial uses E and nu.']},
  'aluminium-6061-t6': {id: 'aluminium-6061-t6', name: 'Aluminium 6061-T6', category: 'metal', grade: 'AA 6061-T6 / T651 (UNS A96061)', isotropic: true,
    properties: {
      density: v(2700, 'asm-6061-t6', '2.7 g/cc (AA; Typical)', 'room temperature'),
      youngModulus: v(68.9e9, 'asm-6061-t6', '68.9 GPa (AA; Typical; average of tension and compression)', 'room temperature',
        {range: [68.9e9, 70.35e9], also: ['nist-cryo-6061'], derived: 'NIST fit E(T) = 77.71221 + 1.030646e-2 T - 2.9241e-4 T^2 + 8.9936e-7 T^3 - 1.0709e-9 T^4 GPa gives 70.35 GPa at 293.15 K'}),
      poissonRatio: v(0.33, 'asm-6061-t6', '0.33 (estimated from trends in similar Al alloys)', 'room temperature'),
      shearModulus: v(26e9, 'asm-6061-t6', '26 GPa (estimated from similar Al alloys)', 'room temperature'),
      yieldStrength: v(276e6, 'asm-6061-t6', '276 MPa (AA; Typical)', 'T6, room temperature'),
      tensileStrength: v(310e6, 'asm-6061-t6', '310 MPa (AA; Typical)', 'T6, room temperature'),
      fractureToughness: v(29e6, 'asm-6061-t6', '29 MPa-m^1/2 (K_IC; TL orientation)', 'T6, TL orientation'),
      thermalConductivity: v(167, 'asm-6061-t6', '167 W/m-K (AA; Typical at 77 °F)', '25 °C',
        {range: [154.4, 167], also: ['nist-cryo-6061'], derived: 'NIST log-polynomial fit evaluated at 293.15 K gives 154.4 W/(m K) (fit error 0.5%)'}),
      specificHeat: v(896, 'asm-6061-t6', '0.896 J/g-°C', 'room temperature',
        {range: [896, 943], also: ['nist-cryo-6061'], derived: 'NIST log-polynomial fit evaluated at 293.15 K gives 943 J/(kg K) (fit error 5%)'}),
      thermalExpansion: v(23.6e-6, 'asm-6061-t6', '23.6 µm/m-°C (AA; Typical; average over 68-212 °F)', 'mean, 20 to 100 °C')}},
  'copper-c11000': {id: 'copper-c11000', name: 'Copper C11000 (ETP)', category: 'metal', grade: 'C11000 electrolytic tough pitch, annealed (OS050) unless stated', isotropic: true,
    properties: {
      density: v(8910, 'cda-c11000', 'specific gravity 8.91; density 0.322 lb/cu in at 68 °F (actual 0.321 - 0.323)', '20 °C',
        {range: [8885, 8941], derived: '0.321 and 0.323 lb/in^3 x 27679.9'}),
      youngModulus: v(117.21e9, 'cda-c11000', 'modulus of elasticity in tension 17000 ksi', 'room temperature', {derived: '17000 ksi x 6.894757 MPa/ksi'}),
      shearModulus: v(44.126e9, 'cda-c11000', 'modulus of rigidity 6400 ksi', 'room temperature', {derived: '6400 ksi x 6.894757 MPa/ksi'}),
      poissonRatio: v(0.328, 'cda-c11000', 'derived from the two moduli above', 'room temperature', {derived: 'nu = E / (2 G) - 1 = 117.21 / 88.25 - 1'}),
      yieldStrength: v(68.95e6, 'cda-c11000', 'YS-0.5% Ext 10 ksi (flat, OS050, typical); 44 ksi for hard (H04) rod', 'annealed OS050; up to hard H04',
        {range: [68.95e6, 303.4e6], derived: 'ksi x 6.894757 MPa/ksi'}),
      tensileStrength: v(220.6e6, 'cda-c11000', 'tensile strength 32 ksi (flat, OS050, typical); 48 ksi for hard (H04) rod', 'annealed OS050; up to hard H04',
        {range: [220.6e6, 330.9e6], derived: 'ksi x 6.894757 MPa/ksi'}),
      thermalConductivity: v(391.1, 'cda-c11000', '226 Btu/ sq ft/ ft hr/ °F at 68 °F', '20 °C', {derived: '226 x 1.730735 W/(m K) per Btu/(ft h °F)'}),
      specificHeat: v(385.2, 'cda-c11000', '0.092 Btu/ lb /°F at 68 °F', '20 °C', {derived: '0.092 x 4186.8 J/(kg K) per Btu/(lb °F)'}),
      thermalExpansion: v(16.92e-6, 'cda-c11000', '9.4 x 10^-6 per °F (68 - 212 °F)', 'mean, 20 to 100 °C', {derived: '9.4e-6 x 1.8'})}},
  'cast-iron-gjl-250': {id: 'cast-iron-gjl-250', name: 'Grey cast iron EN-GJL-250', category: 'metal', grade: 'EN-GJL-250 (EN-JL-1040; comparable ASTM A48 class 35/40), pearlitic, separately cast 30 mm specimen', isotropic: true,
    properties: {
      density: v(7200, 'ke-en1561', '7,20 g/cm3', 'room temperature'),
      youngModulus: v(110.5e9, 'ke-en1561', 'E (load-dependent) 103 - 118 kN/mm2', 'room temperature, depends on the load', {range: [103e9, 118e9], derived: 'middle of the stated range'}),
      poissonRatio: v(0.26, 'ke-en1561', '0,26', 'room temperature'),
      yieldStrength: v(196.5e6, 'ke-en1561', 'Rp0,1 165 - 228 N/mm2 (0.1% elastic limit)', '0.1% proof stress', {range: [165e6, 228e6], derived: 'middle of the stated range'}),
      tensileStrength: v(300e6, 'ke-en1561', 'Rm 250 - 350 N/mm2', 'separately cast 30 mm specimen', {range: [250e6, 350e6], derived: 'middle of the stated range'}),
      compressiveStrength: v(840e6, 'ke-en1561', 'sigma_dB 840 N/mm2', 'room temperature'),
      fractureToughness: v(15.18e6, 'ke-en1561', 'K_IC 480 N/mm^3/2', 'room temperature', {derived: '480 N/mm^1.5 x 31622.8 (Pa m^0.5 per N mm^-1.5)'}),
      thermalConductivity: v(48.5, 'ke-en1561', 'lambda (100 - 500 °C) 48,5 - 44,5 W/(m K)', '100 °C (44.5 at 500 °C)', {range: [44.5, 48.5]}),
      specificHeat: v(460, 'ke-en1561', 'c 20° - 200° C = 460 J/(kg K)', 'mean, 20 to 200 °C'),
      thermalExpansion: v(11.7e-6, 'ke-en1561', 'alpha 20° - 200° C = 11,7 µm/(m K)', 'mean, 20 to 200 °C')}},
  'soda-lime-glass': {id: 'soda-lime-glass', name: 'Soda-lime glass', category: 'glass', grade: 'float / sheet soda-lime-silica glass, annealed', isotropic: true,
    properties: {
      density: v(2500, 'ct-soda-lime', '2 500 kg/m3 (@ 18 °C)', '18 °C'),
      youngModulus: v(72e9, 'ct-soda-lime', '72 GPa', 'room temperature'),
      shearModulus: v(30e9, 'ct-soda-lime', '30 GPa', 'room temperature'),
      poissonRatio: v(0.23, 'ct-soda-lime', '0,23', 'room temperature'),
      flexuralStrength: v(41e6, 'ct-soda-lime', 'flexural strength, annealed: 41 MPa (heat-strengthened 83, toughened 165)', 'annealed'),
      fractureToughness: v(0.75e6, 'salem-jenkins-2018', 'soda lime silicate 0.75 ± 0.04 (35/73) in air; 0.79 ± 0.02 in dry N2 (MPa√m, ASTM C1421)', 'in air at 35% RH and 73 °F; 0.79 MPa√m dry',
        {uncertainty: 0.04e6, range: [0.71e6, 0.81e6], derived: 'range: air mean minus one deviation to dry mean plus one deviation'}),
      thermalConductivity: v(0.937, 'ct-soda-lime', '0,937 W/(m K)', 'room temperature'),
      specificHeat: v(880, 'ct-soda-lime', '0,88 kJ/(kg K)', 'room temperature'),
      thermalExpansion: v(8.3e-6, 'ct-soda-lime', '8,3 * 10^-6 °C', 'room temperature')},
    notes: ['The strength of glass is set by its surface flaws, not by a material constant; 41 MPa is the sheet\'s figure for annealed glass in bending.']},
  'soda-lime-glass-toughened': {id: 'soda-lime-glass-toughened', name: 'Soda-lime glass, thermally toughened', category: 'glass', grade: 'float soda-lime-silica glass, thermally toughened (tempered)', isotropic: true,
    properties: {
      density: v(2500, 'ct-soda-lime', '2 500 kg/m3 (@ 18 °C)', '18 °C; toughening does not change the glass'),
      youngModulus: v(72e9, 'ct-soda-lime', '72 GPa', 'room temperature'),
      shearModulus: v(30e9, 'ct-soda-lime', '30 GPa', 'room temperature'),
      poissonRatio: v(0.23, 'ct-soda-lime', '0,23', 'room temperature'),
      flexuralStrength: v(165e6, 'ct-soda-lime', 'flexural strength, annealed: 41 MPa (heat-strengthened 83, toughened 165)', 'thermally toughened'),
      fractureToughness: v(0.75e6, 'salem-jenkins-2018', 'soda lime silicate 0.75 ± 0.04 (35/73) in air; 0.79 ± 0.02 in dry N2 (MPa√m, ASTM C1421)', 'in air at 35% RH and 73 °F; toughening adds residual stress, not toughness',
        {uncertainty: 0.04e6, range: [0.71e6, 0.81e6], derived: 'range: air mean minus one deviation to dry mean plus one deviation'})},
    notes: ['Toughening puts the surfaces in compression. The difference between the toughened and annealed flexural strengths of the same sheet, 165 - 41 = 124 MPa, is the surface compression a crack must first overcome.']},
  'borosilicate-glass': {id: 'borosilicate-glass', name: 'Borosilicate glass (BOROFLOAT 33)', category: 'glass', grade: 'SCHOTT BOROFLOAT 33 float borosilicate glass', isotropic: true,
    properties: {
      density: v(2230, 'schott-borofloat-33', 'Density (25 °C) 2.23 g/cm3', '25 °C'),
      youngModulus: v(64e9, 'schott-borofloat-33', 'Young\'s Modulus (according to DIN 13316) 64 kN/mm2', 'room temperature'),
      poissonRatio: v(0.2, 'schott-borofloat-33', 'Poisson\'s Ratio µ (according to DIN 13316) 0.2', 'room temperature'),
      flexuralStrength: v(25e6, 'schott-borofloat-33', 'Bending Strength (according to DIN 52292 T 1) 25 MPa', 'DIN 52292 part 1'),
      thermalExpansion: v(3.25e-6, 'schott-borofloat-33', 'Linear Thermal Expansion (C.T.E.) alpha(20 - 300 °C) 3.25 x 10-6 K-1', 'mean, 20 to 300 °C')},
    notes: ['25 MPa is the datasheet\'s bending strength, lower than the 41 MPa of the annealed soda-lime sheet in this library; both are set by surface flaws.']},
  'pvb-interlayer': {id: 'pvb-interlayer', name: 'PVB interlayer (Stratobel)', category: 'polymer', grade: 'standard PVB of AGC Stratobel laminated glass, nominal 0.76 mm (xx.2)', isotropic: true,
    properties: {
      density: v(1070, 'agc-stratobel-pvb', 'Density at 23 °C ASTM D792: Stratobel 1070 kg/m3', '23 °C'),
      youngModulus: v(33e6, 'agc-stratobel-pvb', 'Wind gust (other areas), 3 sec., 0 °C to 20 °C: Young\'s modulus E 33 MPa (Stratobel)', 'relaxation modulus for a 3 s load at 0 to 20 °C; shorter loads are stiffer', {range: [2.5e6, 33e6], derived: 'range: 2.5 MPa (3 s, 0 to 35 °C) to 33 MPa (3 s, 0 to 20 °C)'}),
      poissonRatio: v(0.5, 'agc-stratobel-pvb', 'Poisson\'s ratio at 23 °C and 50% RH ASTM D638: Stratobel 0.5', '23 °C, 50% RH')},
    notes: ['A viscoelastic polymer: its modulus falls by orders of magnitude with load duration and temperature (the source tabulates 0.19 to 33 MPa for standard PVB). An impact lasts milliseconds, shorter than the shortest tabulated duration, so 33 MPa is a lower bound there.']},
  'concrete-c30-37': {id: 'concrete-c30-37', name: 'Concrete C30/37', category: 'concrete', grade: 'normal-weight concrete, strength class C30/37 (EN 1992-1-1), siliceous or calcareous aggregate', isotropic: true,
    properties: {
      density: v(2400, 'en1992-1-2', '2300 kg/m3 (siliceous concrete with 3% moisture, EN 1992-1-2 3.3.2 figure); ≈ 2500 kg/m3 for reinforced concrete (design aid)', 'plain normal-weight concrete',
        {range: [2300, 2500], also: ['ec2-design-properties'], derived: 'middle of the two figures read'}),
      youngModulus: v(32.837e9, 'ec2-design-properties', 'E_cm = 32837 MPa (C30/37)', 'secant modulus at 28 days, quartzite-type aggregate'),
      poissonRatio: v(0.2, 'ec2-design-properties', 'nu = 0.2 (uncracked concrete), clause 3.1.3(4)', 'uncracked'),
      compressiveStrength: v(38e6, 'ec2-design-properties', 'f_cm = 38 MPa (f_ck = 30 MPa)', 'mean cylinder strength at 28 days; characteristic 30 MPa', {range: [30e6, 38e6]}),
      tensileStrength: v(2.9e6, 'ec2-design-properties', 'f_ctm = 2.90 MPa', 'mean axial tensile strength at 28 days'),
      thermalConductivity: v(1.642, 'en1992-1-2', 'upper limit lambda_c = 2 - 0,2451 (theta/100) + 0,0107 (theta/100)^2 W/m K; lower limit 1,36 - 0,136 (theta/100) + 0,0057 (theta/100)^2', '20 °C',
        {range: [1.333, 1.951], derived: 'both limits evaluated at 20 °C; the value is their mean'}),
      specificHeat: v(900, 'en1992-1-2', 'c_p(theta) = 900 J/kg K for 20 °C <= theta <= 100 °C', 'dry concrete (moisture 0%), 20 to 100 °C'),
      thermalExpansion: v(10e-6, 'ec2-design-properties', 'alpha = 10 x 10^-6 1/K, clause 3.1.3(5)', 'design value')},
    notes: ['No fracture energy: the fib Model Code formula was not opened in a source, so fractureLaw needs `toughness` for concrete.']},
  'granite-barre': {id: 'granite-barre', name: 'Granite (Barre)', category: 'stone', grade: 'Barre granite (Vermont), intact laboratory specimen', isotropic: true,
    properties: {
      density: v(2659.3, 'ucrl-15151', 'unit weight 2659.3 kg/m3', 'intact, natural moisture'),
      youngModulus: v(72.4e9, 'ucrl-15151', 'Young\'s modulus 72.4 GPa', 'intact'),
      poissonRatio: v(0.22, 'ucrl-15151', 'Poisson\'s ratio 0.22', 'intact'),
      shearModulus: v(29.7e9, 'ucrl-15151', 'shear modulus 29.7 GPa', 'intact'),
      compressiveStrength: v(234.5e6, 'ucrl-15151', 'uniaxial compressive strength 234.5 MPa', 'intact'),
      tensileStrength: v(7.6e6, 'ucrl-15151', 'tensile strength 7.6 MPa', 'intact'),
      thermalConductivity: v(2.37, 'ucrl-15151', 'thermal conductivity 2.37 W/m °K', 'room temperature')},
    notes: ['Heat capacity and expansion coefficient are in the same table but not legible in the scanned copy; fracture toughness was not found in an opened source.']},
  'oak-red-northern': {id: 'oak-red-northern', name: 'Northern red oak, along the grain', category: 'wood', grade: 'Quercus rubra, clear straight-grained, 12% moisture content', isotropic: false,
    properties: {
      density: v(705.6, 'wood-handbook-ch5', 'specific gravity 0.63 at 12% (oven-dry mass, volume at 12%)', '12% moisture content',
        {also: ['wood-handbook-ch4'], derived: 'rho = G_12 (1 + 0.12) x 1000 kg/m3 (Table 4-6a gives 694 and 717 for G = 0.62 and 0.64)'}),
      youngModulus: v(13.75e9, 'wood-handbook-ch5', 'modulus of elasticity 12,500 MPa (static bending); "to correct for shear deflection, the modulus can be increased by 10%"', 'E_L, 12% moisture content',
        {range: [12.5e9, 13.75e9], derived: '12.5 GPa x 1.10'}),
      poissonRatio: v(0.350, 'wood-handbook-ch5', 'mu_LR 0.350, mu_LT 0.448 (Table 5-2, oak, red)', 'nu_LR, about 12% moisture content', {range: [0.350, 0.448]}),
      shearModulus: v(1.224e9, 'wood-handbook-ch5', 'G_LR / E_L = 0.089 (Table 5-1, oak, red)', 'G_LR, about 12% moisture content', {derived: '0.089 x 13.75 GPa'}),
      flexuralStrength: v(99e6, 'wood-handbook-ch5', 'modulus of rupture 99,000 kPa', '12% moisture content, clear specimen'),
      compressiveStrength: v(46.6e6, 'wood-handbook-ch5', 'compression parallel to grain 46,600 kPa', '12% moisture content, clear specimen'),
      fractureToughness: v(0.385e6, 'wood-handbook-ch5', 'mode I fracture toughness 220 to 550 kPa m^1/2 (all species)', 'crack along the grain (TL, RL), 10 to 12% moisture content',
        {range: [0.22e6, 0.55e6], derived: 'middle of the stated range'}),
      thermalConductivity: v(0.309, 'wood-handbook-ch4', 'k = G_x (B + C x) + A, A = 0.01864, B = 0.1941, C = 0.004064 (across the grain); along the grain greater by a factor of 1.5 to 2.8, average about 1.8', 'along the grain, 12% moisture, about 24 °C',
        {range: [0.257, 0.481], derived: 'across 0.1716 W/(m K) at G = 0.63, x = 12, times 1.8 (1.5 to 2.8)'}),
      specificHeat: v(1620, 'wood-handbook-ch4', 'c_p0 = 0.1031 + 0.003867 T; c_p,x = (c_p0 + c_pw x/100)/(1 + x/100) + A_c; A_c = x (b1 + b2 T + b3 x), b1 = -0.06191, b2 = 2.36e-4, b3 = -1.33e-4', '12% moisture content, 293.15 K',
        {derived: 'evaluated at T = 293.15 K, x = 12, c_pw = 4.18 kJ/(kg K): 1.620 kJ/(kg K)'}),
      thermalExpansion: v(3.8e-6, 'wood-handbook-ch4', 'parallel-to-grain values have ranged from about 3.1 to 4.5 x 10^-6 K^-1', 'along the grain, oven-dry wood', {range: [3.1e-6, 4.5e-6], derived: 'middle of the stated range'})},
    notes: ['Orthotropic: E_T / E_L = 0.082 and E_R / E_L = 0.154 (Table 5-1). solidMaterial uses the along-grain values as if isotropic, which is right only for loads along the grain.']},
  'pine-loblolly': {id: 'pine-loblolly', name: 'Loblolly pine (southern pine), along the grain', category: 'wood', grade: 'Pinus taeda, clear straight-grained, 12% moisture content', isotropic: false,
    properties: {
      density: v(571.2, 'wood-handbook-ch5', 'specific gravity 0.51 at 12%', '12% moisture content', {also: ['wood-handbook-ch4'], derived: 'rho = G_12 (1 + 0.12) x 1000 kg/m3'}),
      youngModulus: v(13.53e9, 'wood-handbook-ch5', 'modulus of elasticity 12,300 MPa (static bending), +10% for shear deflection', 'E_L, 12% moisture content', {range: [12.3e9, 13.53e9], derived: '12.3 GPa x 1.10'}),
      poissonRatio: v(0.328, 'wood-handbook-ch5', 'mu_LR 0.328, mu_LT 0.292 (Table 5-2, pine, loblolly)', 'nu_LR, about 12% moisture content', {range: [0.292, 0.328]}),
      shearModulus: v(1.109e9, 'wood-handbook-ch5', 'G_LR / E_L = 0.082 (Table 5-1, pine, loblolly)', 'G_LR, about 12% moisture content', {derived: '0.082 x 13.53 GPa'}),
      flexuralStrength: v(88e6, 'wood-handbook-ch5', 'modulus of rupture 88,000 kPa', '12% moisture content, clear specimen'),
      compressiveStrength: v(49.2e6, 'wood-handbook-ch5', 'compression parallel to grain 49,200 kPa', '12% moisture content, clear specimen'),
      fractureToughness: v(0.385e6, 'wood-handbook-ch5', 'mode I fracture toughness 220 to 550 kPa m^1/2 (all species)', 'crack along the grain (TL, RL), 10 to 12% moisture content',
        {range: [0.22e6, 0.55e6], derived: 'middle of the stated range'}),
      thermalConductivity: v(0.2565, 'wood-handbook-ch4', 'k = G_x (B + C x) + A across the grain; along the grain 1.5 to 2.8 times, average about 1.8', 'along the grain, 12% moisture, about 24 °C',
        {range: [0.2138, 0.399], derived: 'across 0.1425 W/(m K) at G = 0.51, x = 12, times 1.8 (1.5 to 2.8)'}),
      specificHeat: v(1620, 'wood-handbook-ch4', 'equations 4-16a, 4-17, 4-18 (independent of species)', '12% moisture content, 293.15 K', {derived: 'evaluated at T = 293.15 K, x = 12'}),
      thermalExpansion: v(3.8e-6, 'wood-handbook-ch4', 'parallel-to-grain values about 3.1 to 4.5 x 10^-6 K^-1', 'along the grain, oven-dry wood', {range: [3.1e-6, 4.5e-6], derived: 'middle of the stated range'})},
    notes: ['Orthotropic: E_T / E_L = 0.078 and E_R / E_L = 0.113 (Table 5-1).']},
  'pmma': {id: 'pmma', name: 'PMMA (cast acrylic)', category: 'polymer', grade: 'PLEXIGLAS GS (cast), 23 °C and 50% RH', isotropic: true,
    properties: {
      density: v(1190, 'evonik-plexiglas', '1.19 g/cm3 (ISO 1183)', '23 °C'),
      youngModulus: v(3.3e9, 'evonik-plexiglas', 'modulus of elasticity E_t (short-term value) 3300 MPa (ISO 527-2/1B/1)', 'short-term, 23 °C'),
      poissonRatio: v(0.37, 'evonik-plexiglas', 'Poisson\'s ratio 0.37 (5% per min, up to 2% dilatation, 23 °C)', '23 °C'),
      shearModulus: v(1.7e9, 'evonik-plexiglas', 'dynamic shear modulus G at approx. 10 Hz 1700 MPa (ISO 537)', 'dynamic, about 10 Hz, 23 °C'),
      tensileStrength: v(80e6, 'evonik-plexiglas', 'tensile strength 80 MPa at 23 °C (110 at -40 °C, 40 at 70 °C)', '23 °C'),
      flexuralStrength: v(115e6, 'evonik-plexiglas', 'flexural strength 115 MPa (ISO 178)', '23 °C'),
      compressiveStrength: v(110e6, 'evonik-plexiglas', 'compressive yield stress 110 MPa (ISO 604)', '23 °C'),
      thermalConductivity: v(0.19, 'evonik-plexiglas', '0.19 W/mK (DIN 52612)', 'room temperature'),
      specificHeat: v(1470, 'evonik-plexiglas', '1.47 J/gK', 'room temperature'),
      thermalExpansion: v(70e-6, 'evonik-plexiglas', '7 x 10^-5 1/K for 0 - 50 °C', 'mean, 0 to 50 °C')},
    flags: ['The dynamic shear modulus (10 Hz) is 41% above E / (2 (1 + nu)) = 1.20 GPa from the short-term tensile modulus: PMMA is viscoelastic and the two are measured at different rates.']},
  'abs': {id: 'abs', name: 'ABS', category: 'polymer', grade: 'Terluran GP-35, general purpose injection moulding grade, 23 °C', isotropic: true,
    properties: {
      density: v(1040, 'basf-terluran-gp35', '1040 kg/m3 (ISO 1183)', '23 °C'),
      youngModulus: v(2.3e9, 'basf-terluran-gp35', 'tensile modulus 2300 MPa (ISO 527-1/-2)', '23 °C'),
      yieldStrength: v(44e6, 'basf-terluran-gp35', 'yield stress, 50 mm/min, 44 MPa', '23 °C, 50 mm/min'),
      flexuralStrength: v(65e6, 'basf-terluran-gp35', 'flexural strength 65 MPa (ISO 178)', '23 °C'),
      thermalConductivity: v(0.17, 'basf-terluran-gp35', 'thermal conductivity 0.17 W/(m K) (DIN 52612-1)', 'room temperature'),
      thermalExpansion: v(95e-6, 'basf-terluran-gp35', 'coefficient of linear thermal expansion, longitudinal (23-80) °C, 0.8 - 1.1 E-4/°C', 'mean, 23 to 80 °C',
        {range: [80e-6, 110e-6], derived: 'middle of the stated range'})},
    notes: ['No Poisson\'s ratio or specific heat in the opened datasheet: solidMaterial and heatMaterial need them as overrides.']},
  'nylon-66': {id: 'nylon-66', name: 'Nylon 66 (PA66)', category: 'polymer', grade: 'Zytel 101L NC010, unreinforced, dry as moulded (conditioned values in the ranges)', isotropic: true,
    properties: {
      density: v(1140, 'dupont-zytel-101l', 'density 1140 kg/m3 (ISO 1183)', 'dry, 23 °C'),
      youngModulus: v(3.1e9, 'dupont-zytel-101l', 'tensile modulus 3100 / 1400 MPa (dry / conditioned, ISO 527-1/-2)', 'dry as moulded, 23 °C; 1.4 GPa conditioned', {range: [1.4e9, 3.1e9]}),
      poissonRatio: v(0.37, 'dupont-zytel-101l', 'Poisson\'s ratio 0.37 / 0.43 (dry / conditioned)', 'dry; 0.43 conditioned', {range: [0.37, 0.43]}),
      yieldStrength: v(82e6, 'dupont-zytel-101l', 'yield stress, 50 mm/min, 82 / 55 MPa (dry / conditioned)', 'dry; 55 MPa conditioned', {range: [55e6, 82e6]}),
      thermalConductivity: v(0.24, 'dupont-zytel-101l', 'thermal conductivity 0.24 W/(m K) (ISO 22007-2)', 'solid'),
      thermalExpansion: v(100e-6, 'dupont-zytel-101l', 'coeff. of linear therm. expansion, parallel 100 E-6/K (normal 110)', 'parallel to flow', {range: [100e-6, 110e-6]})},
    notes: ['No specific heat of the solid in the opened datasheet (only of the melt): heatMaterial needs it as an override.']},
  'ptfe': {id: 'ptfe', name: 'PTFE', category: 'polymer', grade: 'unfilled PTFE, 23 °C', isotropic: true,
    properties: {
      density: v(2160, 'proplas-ptfe', '2.16 g/cm3 (ASTM D792)', '23 °C'),
      youngModulus: v(551.6e6, 'proplas-ptfe', 'tensile modulus 80,000 psi (ASTM D638)', '23 °C', {derived: '80000 psi x 6894.757 Pa/psi'}),
      tensileStrength: v(26.89e6, 'proplas-ptfe', 'tensile strength 3,900 psi (ASTM D638)', '23 °C', {derived: '3900 psi x 6894.757 Pa/psi'}),
      compressiveStrength: v(24.13e6, 'proplas-ptfe', 'compressive strength 3,500 psi (ASTM D695)', '23 °C', {derived: '3500 psi x 6894.757 Pa/psi'}),
      thermalConductivity: v(0.2452, 'proplas-ptfe', '1.70 BTU-in/ft2-hr-°F; 5.86 x 10^-4 cal/cm-sec-°C (ASTM C177)', '23 °C', {derived: '5.86e-4 x 418.4'}),
      thermalExpansion: v(135e-6, 'proplas-ptfe', '7.5 x 10^-5 in./in./°F (ASTM D696)', 'around 23 °C', {derived: '7.5e-5 x 1.8'})},
    notes: ['No Poisson\'s ratio or specific heat in the opened datasheet: solidMaterial and heatMaterial need them as overrides.']},
  'natural-rubber': {id: 'natural-rubber', name: 'Natural rubber', category: 'elastomer', grade: 'pure-gum (unfilled) vulcanizate for the stiffness; rubber hydrocarbon for density, expansion and heat capacity', isotropic: true,
    properties: {
      density: v(921.7, 'nbs-rp717', 'taking the density to be 0.921 7 at that temperature (dilatometer sample of rubber hydrocarbon)', 'unvulcanized rubber hydrocarbon, near room temperature (the temperature is not legible in the scanned copy)'),
      youngModulus: v(1.5e6, 'wood-1977-rubber', '1, 1.5, and 2 MPa respectively, normal values for a pure-gum vulcanizate at different increasing degrees of cross-linking', 'small strain, pure-gum vulcanizate', {range: [1e6, 2e6]}),
      shearModulus: v(0.5e6, 'wood-1977-rubber', 'Young\'s modulus "will be equal to 3G where G is the shear modulus"', 'small strain', {range: [0.333e6, 0.667e6], derived: 'G = E / 3'}),
      poissonRatio: v(0.5, 'wood-1977-rubber', 'E = 3G (incompressible)', 'small strain', {derived: 'E = 2 G (1 + nu) with E = 3 G gives nu = 0.5; the solver helpers use 0.4999, the largest value the solvers accept'}),
      specificHeat: v(1880, 'nbs-rp844', 'At 298.1 °K the heat capacity of the rubber is 1.880 ± 0.002 j/g/°C', 'rubber hydrocarbon, 298.1 K', {uncertainty: 2}),
      thermalExpansion: v(223e-6, 'nbs-rp717', 'volume coefficient of expansion (amorphous I form, -72 to +85 °C) = 0.00067 + 0.0000007 (t - 25)', 'linear, 25 °C', {derived: 'one third of the volume coefficient 6.7e-4 at 25 °C'})},
    notes: ['Thermal conductivity was not found in an opened source. Filled compounds are denser and stiffer than these values.']},
  'ice': {id: 'ice', name: 'Ice (freshwater, polycrystalline)', category: 'ice', grade: 'pristine terrestrial ice Ih, about 3 mm grains; thermal values at -10 °C', isotropic: true,
    properties: {
      density: v(918.9, 'etb-ice', '918.9 kg/m3 at -10 °C (916.2 at 0 °C, 920.0 at -30 °C)', '-10 °C', {range: [916.2, 920.0]}),
      youngModulus: v(9.3e9, 'schulson-renshaw-2022', 'Young\'s modulus E = 9.3 GPa (Gammon et al. 1983) under terrestrial conditions', 'terrestrial conditions'),
      poissonRatio: v(0.33, 'schulson-renshaw-2022', 'Poisson\'s ratio = 0.33 (Gammon et al. 1983)', 'terrestrial conditions'),
      fractureToughness: v(0.1e6, 'schulson-renshaw-2022', 'K_Ic = 0.1 MPa m^1/2 for pristine, terrestrial ice of ∼3-mm grain size; 0.14 at -173 °C', 'about 3 mm grains, near -10 °C', {range: [0.1e6, 0.14e6]}),
      fractureEnergy: v(1, 'schulson-renshaw-2022', 'G_c = K_Ic^2 (1 - nu^2) / E ... giving G_c = 1 J m^-2', 'plane strain, from the values above'),
      thermalConductivity: v(2.30, 'etb-ice', '2.30 W/mK at -10 °C (2.22 at 0 °C)', '-10 °C', {range: [2.22, 2.50]}),
      specificHeat: v(2000, 'etb-ice', '2.000 kJ/kgK at -10 °C (2.050 at 0 °C)', '-10 °C', {range: [1882, 2050]})},
    notes: ['No tensile strength in an opened source: fractureLaw needs `strength` for ice.']},
  'water': {id: 'water', name: 'Water at 20 °C', category: 'fluid', grade: 'liquid water, 293.15 K, 0.101325 MPa (IAPWS-95 via NIST)', isotropic: true,
    properties: {
      density: v(998.207, 'nist-webbook-water', '998.207 kg/m3', '293.15 K, 0.101325 MPa'),
      specificHeat: v(4184.05, 'nist-webbook-water', 'Cp 4.18405 J/g*K', '293.15 K, 0.101325 MPa'),
      thermalConductivity: v(0.598012, 'nist-webbook-water', 'therm. cond. 0.598012 W/m*K', '293.15 K, 0.101325 MPa'),
      viscosity: v(1.0016e-3, 'nist-webbook-water', 'viscosity 0.00100160 Pa*s', '293.15 K, 0.101325 MPa'),
      soundSpeed: v(1482.35, 'nist-webbook-water', 'sound spd. 1482.35 m/s', '293.15 K, 0.101325 MPa')}},
  'air': {id: 'air', name: 'Air at 20 °C', category: 'fluid', grade: 'dry air, 20 °C, 1 atm', isotropic: true,
    properties: {
      density: v(1.204, 'cengel-a9-air', 'rho 1.204 kg/m3 at 20 °C', '20 °C, 1 atm'),
      specificHeat: v(1007, 'cengel-a9-air', 'c_p 1007 J/kg K at 20 °C', '20 °C, 1 atm'),
      thermalConductivity: v(0.02514, 'cengel-a9-air', 'k 0.02514 W/m K at 20 °C', '20 °C, 1 atm'),
      viscosity: v(1.825e-5, 'cengel-a9-air', 'mu 1.825 x 10^-5 kg/m s at 20 °C', '20 °C, 1 atm')}},
  'glycerol': {id: 'glycerol', name: 'Glycerol at 20 °C', category: 'fluid', grade: 'anhydrous glycerol (100% by weight), 20 °C, 1 atm', isotropic: true,
    properties: {
      density: v(1261.08, 'volk-kahler-2018', '100 w/w %: 1.26108 at 20 °C (g/cm3)', '100% glycerol, 20 °C', {derived: 'g/cm3 times 1000'}),
      viscosity: v(1.412, 'segur-oberstar-1951', '100% glycerol, 20 °C: 1412 centipoise (Table V)', '100% glycerol, 20 °C', {derived: '1 cP = 1e-3 Pa s'})},
    notes: ['A few percent of water lowers the viscosity sharply: 99% glycerol is 1150 cP and 95% is 523 cP at 20 °C in the same table.']},
  'olive-oil': {id: 'olive-oil', name: 'Olive oil (refined)', category: 'fluid', grade: 'refined olive oil (Salada brand), viscosity at 20 °C, density at 25 °C', isotropic: true,
    properties: {
      density: v(879, 'brock-2008', 'Oliva: ρ 0,879 ± 0,003 g/cm3 at 25 ± 1 °C (Tabela 2)', '25 °C (not 20 °C)', {uncertainty: 3, derived: 'g/cm3 times 1000'}),
      viscosity: v(79.7e-3, 'brock-2008', 'Oliva, T 20,0 °C: 79,7 mPa.s (Tabela 3)', '20 °C, constant shear rate', {derived: '1 mPa s = 1e-3 Pa s'})}},
  'honey': {id: 'honey', name: 'Honey (industrialized)', category: 'fluid', grade: 'industrialized bee honey, 20.8 to 24.4% water, 73.6 to 77.3 °Brix, 20 °C', isotropic: true,
    properties: {
      density: unverified(1420, '20 °C, about 17 to 18% water', 'The opened source measured the specific gravity but its table was not readable; 1420 kg/m3 is a typical figure recalled, not read. A honey with 22% water, as in the viscosity source, is lighter (about 1.38 to 1.40).'),
      viscosity: v(7.43, 'rodriguez-navarro-2022', 'mean absolute viscosity at 20 ºC (7430 mPa∙s); Newtonian', '20 °C, Brookfield RVDV-E viscometer, mean of the samples', {derived: '1 mPa s = 1e-3 Pa s'})},
    notes: ['Honey viscosity depends strongly on water content and temperature: 2636 mPa s at 30 °C in the same source.']},
  'glass-beads': {id: 'glass-beads', name: 'Glass beads', category: 'granular', grade: 'solid glass spheres of about 2 to 4 mm', isotropic: true,
    properties: {
      density: v(2500, 'tang-2019', 'density of glass beads rho 2500 kg/m3 (Table 5)', 'beads of 2 mm', {range: [2500, 2600], also: ['sandeep-2020'], derived: 'Sandeep et al. 2020 Table 1: 2.60 t/m3'}),
      youngModulus: v(46.2e9, 'tang-2019', 'Young\'s modulus of glass beads E 46.2 GPa (Table 5, DEM input; the paper does not say how it was obtained)', 'DEM input',
        {range: [46.2e9, 65e9], also: ['sandeep-2018'], derived: 'Sandeep and Senetakis 2018: 58 ± 7 GPa back-calculated from grain-contact tests'}),
      poissonRatio: v(0.245, 'tang-2019', 'Poisson\'s ratio of glass beads 0.245 (Table 5)', 'DEM input', {range: [0.245, 0.30], also: ['sandeep-2018'], derived: 'Sandeep and Senetakis 2018 use 0.30 from the literature'})},
    notes: ['Grain-scale moduli back-calculated from contact tests depend on surface roughness; they are not the bulk modulus of the glass.']},
  'sand-quartz': {id: 'sand-quartz', name: 'Quartz sand', category: 'granular', grade: 'Leighton Buzzard quartz sand grains, 1.18 to 2.36 mm', isotropic: true,
    properties: {
      density: v(2650, 'webmineral-quartz', 'Specific Gravity of Quartz = 2.65 gm/cc; density 2.6 - 2.65, average = 2.62', 'quartz mineral (grain density, not bulk density)', {range: [2600, 2650]}),
      youngModulus: v(52e9, 'sandeep-2018', 'Young\'s modulus E 52 ± 12 GPa (LBS, back-calculated from Hertz fits of grain contacts)', 'grain-scale, back-calculated', {uncertainty: 12e9}),
      poissonRatio: v(0.25, 'sandeep-2018', 'Poisson\'s ratio 0.25 (LBS; based on the literature)', 'assumed by the source')},
    notes: ['No restitution for quartz grains in an opened source: grainMaterial needs `restitution` for sand.']},
} satisfies Record<string, MaterialEntry>);

/** Friction and restitution between pairs of library materials (order of a and b does not matter). */
export const CONTACT_PAIRS: readonly ContactPairEntry[] = deepFreeze([
  {a: 'structural-steel-s355', b: 'structural-steel-s355', condition: 'dry',
    staticFriction: v(0.6, 'openstax-up1', 'steel on steel (dry) mu_s 0.6', 'dry', {range: [0.5, 0.8], also: ['etb-friction'], derived: 'range from the ToolBox: steel on steel, clean and dry, 0.5 - 0.8 static'}),
    kineticFriction: v(0.3, 'openstax-up1', 'steel on steel (dry) mu_k 0.3', 'dry', {range: [0.3, 0.42], also: ['etb-friction'], derived: 'ToolBox: 0.42 kinetic'}),
    restitution: v(0.56, 'zou-2024', 'case 1-2, steel particle on steel plate, falling height 500 and 1000 mm: e_n 0.56', 'steel ball on a 10 mm steel plate, impact 3.1 to 4.4 m/s'),
    impactSpeed: [3.13, 4.43]},
  {a: 'structural-steel-s355', b: 'structural-steel-s355', condition: 'lubricated',
    staticFriction: v(0.05, 'openstax-up1', 'steel on steel (oiled) mu_s 0.05', 'oiled', {range: [0.05, 0.23], also: ['etb-friction'], derived: 'ToolBox: 0.11 lard to 0.23 light mineral oil, static'}),
    kineticFriction: v(0.03, 'openstax-up1', 'steel on steel (oiled) mu_k 0.03', 'oiled', {range: [0.03, 0.084], also: ['etb-friction'], derived: 'ToolBox: 0.081 castor oil, 0.084 lard'})},
  {a: 'aluminium-6061-t6', b: 'structural-steel-s355', condition: 'dry',
    staticFriction: v(0.61, 'etb-friction', 'Aluminum / Mild Steel, clean and dry: static 0.61', 'clean and dry'),
    kineticFriction: v(0.47, 'etb-friction', 'Aluminum / Mild Steel, clean and dry: kinetic 0.47', 'clean and dry')},
  {a: 'aluminium-6061-t6', b: 'aluminium-6061-t6', condition: 'dry',
    staticFriction: v(1.2, 'etb-friction', 'Aluminum / Aluminum, clean and dry: static 1.05 - 1.35', 'clean and dry', {range: [1.05, 1.35], derived: 'middle of the stated range'}),
    kineticFriction: v(0.4, 'etb-friction', 'Aluminum / Aluminum, clean and dry: kinetic 0.4', 'clean and dry')},
  {a: 'copper-c11000', b: 'structural-steel-s355', condition: 'dry',
    staticFriction: v(0.53, 'etb-friction', 'Copper / Steel, clean and dry: static 0.53', 'clean and dry'),
    kineticFriction: v(0.36, 'etb-friction', 'Copper / Steel, clean and dry: kinetic 0.36', 'clean and dry')},
  {a: 'cast-iron-gjl-250', b: 'cast-iron-gjl-250', condition: 'dry',
    staticFriction: v(1.1, 'etb-friction', 'Cast Iron / Cast Iron, clean and dry: static 1.1', 'clean and dry'),
    kineticFriction: v(0.15, 'etb-friction', 'Cast Iron / Cast Iron, clean and dry: kinetic 0.15', 'clean and dry')},
  {a: 'cast-iron-gjl-250', b: 'structural-steel-s355', condition: 'dry',
    staticFriction: v(0.4, 'etb-friction', 'Cast iron / Steel, clean and dry: static 0.4', 'clean and dry'),
    kineticFriction: v(0.23, 'etb-friction', 'Cast iron / Steel, clean and dry: kinetic 0.23', 'clean and dry')},
  {a: 'soda-lime-glass', b: 'soda-lime-glass', condition: 'dry',
    staticFriction: v(0.95, 'etb-friction', 'Glass / Glass, clean and dry: static 0.9 - 1.0', 'clean and dry', {range: [0.9, 1.0], derived: 'middle of the stated range'}),
    kineticFriction: v(0.4, 'etb-friction', 'Glass / Glass, clean and dry: kinetic 0.4', 'clean and dry')},
  {a: 'soda-lime-glass', b: 'soda-lime-glass', condition: 'lubricated',
    staticFriction: v(0.35, 'etb-friction', 'Glass / Glass, grease: static 0.1 - 0.6', 'greased', {range: [0.1, 0.6], derived: 'middle of the stated range'}),
    kineticFriction: v(0.105, 'etb-friction', 'Glass / Glass, grease: kinetic 0.09 - 0.12', 'greased', {range: [0.09, 0.12], derived: 'middle of the stated range'})},
  {a: 'soda-lime-glass', b: 'structural-steel-s355', condition: 'dry',
    restitution: v(0.71, 'zou-2024', 'case 5-6, glass particle on steel plate, falling height 500 and 1000 mm: e_n 0.71', 'glass ball on a 10 mm steel plate, impact 3.1 to 4.4 m/s'),
    impactSpeed: [3.13, 4.43]},
  {a: 'glass-beads', b: 'glass-beads', condition: 'dry',
    friction: v(0.12, 'sandeep-2018', 'inter-particle friction (µ) 0.12 ± 0.02 (glass balls, 2 mm, normal force 1-5 N)', 'grain on grain, dry, 1 to 5 N',
      {uncertainty: 0.02, range: [0.10, 0.16], also: ['tang-2019'], derived: 'Tang et al. 2019 use mu_s 0.16 between beads (Table 5)'}),
    restitution: v(0.926, 'tang-2019', 'average restitution coefficient, collision material glass bead: 0.926 (Table 3); 0.94 in Table 6', 'bead on bead, slant-plate flat throw; impact speed not stated', {range: [0.926, 0.94]}),
    impactSpeed: null},
  {a: 'glass-beads', b: 'granite-barre', condition: 'dry',
    restitution: v(0.95, 'sandeep-2020', 'glass balls on a granite block: 0.92 - 0.97 (smooth, 2, 3 and 4 mm; 0.95 for 3 mm at every height)', '3 mm smooth glass ball on granite, 1.74 to 2.43 m/s',
      {range: [0.92, 0.97]}), impactSpeed: [1.74, 2.43]},
  {a: 'sand-quartz', b: 'sand-quartz', condition: 'dry',
    friction: v(0.19, 'sandeep-2018', 'inter-particle friction (µ) 0.19 ± 0.04 (Leighton Buzzard sand)', 'grain on grain, dry, 1 to 5 N', {uncertainty: 0.04, range: [0.15, 0.23]})},
  {a: 'oak-red-northern', b: 'oak-red-northern', condition: 'dry',
    staticFriction: v(0.62, 'etb-friction', 'Oak / Oak (parallel grain), clean and dry: static 0.62', 'clean and dry, sliding along the grain'),
    kineticFriction: v(0.48, 'etb-friction', 'Oak / Oak (parallel grain), clean and dry: kinetic 0.48', 'clean and dry, sliding along the grain')},
  {a: 'pine-loblolly', b: 'pine-loblolly', condition: 'dry',
    staticFriction: v(0.5, 'openstax-up1', 'wood on wood mu_s 0.5', 'dry; species not stated'),
    kineticFriction: v(0.3, 'openstax-up1', 'wood on wood mu_k 0.3', 'dry; species not stated')},
  {a: 'pine-loblolly', b: 'structural-steel-s355', condition: 'dry',
    staticFriction: v(0.5, 'openstax-up1', 'metal on wood mu_s 0.5', 'dry'),
    kineticFriction: v(0.3, 'openstax-up1', 'metal on wood mu_k 0.3', 'dry', {range: [0.3, 0.5], also: ['wood-handbook-ch4'],
      derived: 'Wood Handbook: kinetic friction of smooth, dry wood against hard, smooth surfaces commonly 0.3 to 0.5'})},
  {a: 'natural-rubber', b: 'concrete-c30-37', condition: 'dry',
    staticFriction: v(1.0, 'openstax-up1', 'rubber on dry concrete mu_s 1.0', 'dry'),
    kineticFriction: v(0.7, 'openstax-up1', 'rubber on dry concrete mu_k 0.7', 'dry', {range: [0.6, 0.85], also: ['etb-friction'], derived: 'ToolBox: rubber on dry concrete 0.6 - 0.85'})},
  {a: 'natural-rubber', b: 'concrete-c30-37', condition: 'wet',
    staticFriction: v(0.6, 'openstax-up1', 'rubber on wet concrete mu_s 0.5-0.7', 'wet', {range: [0.5, 0.7], derived: 'middle of the stated range'}),
    kineticFriction: v(0.4, 'openstax-up1', 'rubber on wet concrete mu_k 0.3-0.5', 'wet', {range: [0.3, 0.5], derived: 'middle of the stated range'})},
  {a: 'ptfe', b: 'structural-steel-s355', condition: 'dry',
    staticFriction: v(0.04, 'openstax-up1', 'Teflon on steel mu_s 0.04', 'dry', {range: [0.04, 0.2], also: ['etb-friction'], derived: 'ToolBox: PTFE on steel 0.05 - 0.2'}),
    kineticFriction: v(0.04, 'openstax-up1', 'Teflon on steel mu_k 0.04', 'dry')},
  {a: 'ptfe', b: 'ptfe', condition: 'dry',
    staticFriction: v(0.04, 'etb-friction', 'PTFE / PTFE, clean and dry: static 0.04', 'clean and dry'),
    kineticFriction: v(0.04, 'etb-friction', 'PTFE / PTFE, clean and dry: kinetic 0.04', 'clean and dry')},
  {a: 'ice', b: 'ice', condition: 'dry',
    staticFriction: v(0.1, 'openstax-up1', 'ice on ice mu_s 0.1', 'temperature and speed not stated', {range: [0.1, 0.6], also: ['etb-friction', 'schulson-renshaw-2022'],
      derived: 'ToolBox: 0.1 at 0 °C, 0.3 at -12 °C; Schulson and Renshaw: about 0.6 at -10 °C after short holds at 1e-6 to 1e-4 m/s, rising with hold time'}),
    kineticFriction: v(0.03, 'openstax-up1', 'ice on ice mu_k 0.03', 'temperature and speed not stated', {range: [0.02, 0.035], also: ['etb-friction'],
      derived: 'ToolBox: 0.02 at 0 °C, 0.035 at -12 °C. Slow dry sliding at -10 °C is far higher: mu_k = 0.9 V^0.07 (V in m/s; Schulson and Renshaw)'})},
  {a: 'ice', b: 'structural-steel-s355', condition: 'dry',
    staticFriction: v(0.04, 'openstax-up1', 'steel on ice mu_s 0.04', 'temperature not stated'),
    kineticFriction: v(0.02, 'openstax-up1', 'steel on ice mu_k 0.02', 'temperature not stated')},
  {a: 'pmma', b: 'pmma', condition: 'dry',
    friction: v(0.8, 'evonik-plexiglas', 'coefficient of friction mu, plastic / plastic 0.8', 'not stated whether static or kinetic')},
  {a: 'pmma', b: 'structural-steel-s355', condition: 'dry',
    friction: v(0.5, 'evonik-plexiglas', 'coefficient of friction mu, plastic / steel 0.5; steel / plastic 0.45', 'not stated whether static or kinetic', {range: [0.45, 0.5]})},
  {a: 'nylon-66', b: 'nylon-66', condition: 'dry',
    staticFriction: v(0.2, 'etb-friction', 'Nylon / Nylon, clean and dry: static 0.15 - 0.25', 'clean and dry', {range: [0.15, 0.25], derived: 'middle of the stated range'})},
  {a: 'nylon-66', b: 'structural-steel-s355', condition: 'dry',
    staticFriction: v(0.4, 'etb-friction', 'Nylon / Steel, clean and dry: static 0.4', 'clean and dry')},
  // Values the scene editor needs and no opened source gave: kept, marked unverified.
  {a: 'aluminium-6061-t6', b: 'aluminium-6061-t6', condition: 'dry', restitution: unverified(0.5, 'compact body on a hard surface at about 1 m/s', CARRIED), impactSpeed: [1, 1]},
  {a: 'concrete-c30-37', b: 'concrete-c30-37', condition: 'dry',
    staticFriction: unverified(0.6, 'cast against hardened concrete, not roughened', 'The editor\'s earlier table cited ACI 318 shear-friction coefficients; that code was not opened here.'),
    restitution: unverified(0.2, 'compact body on a hard surface at about 1 m/s', CARRIED), impactSpeed: [1, 1]},
  {a: 'natural-rubber', b: 'natural-rubber', condition: 'dry', restitution: unverified(0.8, 'compact body on a hard surface at about 1 m/s', CARRIED), impactSpeed: [1, 1]},
  {a: 'ice', b: 'ice', condition: 'dry', restitution: unverified(0.3, 'compact body on a hard surface at about 1 m/s', CARRIED), impactSpeed: [1, 1]},
  {a: 'pine-loblolly', b: 'pine-loblolly', condition: 'dry', restitution: unverified(0.45, 'compact body on a hard surface at about 1 m/s', CARRIED), impactSpeed: [1, 1]},
] satisfies ContactPairEntry[]);

// ---------------------------------------------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------------------------------------------

export interface MaterialOptions {
  /** Accept values marked `source: 'unverified'`. Default false: such a value is refused. */
  readonly allowUnverified?: boolean;
}

/** The ids of the library's materials, in library order. */
export function materialIds(): string[] { return Object.keys(MATERIALS); }

/** The entry of one material. Throws EngineError INVALID_PAYLOAD for an unknown id. */
export function material(id: string): MaterialEntry {
  if (typeof id !== 'string' || !Object.hasOwn(MATERIALS, id)) throw new EngineError('INVALID_PAYLOAD', `Unknown material "${String(id)}". Known: ${materialIds().join(', ')}.`);
  return MATERIALS[id]!;
}

/** One property with its source and conditions, or null when the library has none. */
export function materialValue(id: string, property: MaterialPropertyName): MaterialValue | null {
  return material(id).properties[property] ?? null;
}

function accept(value: MaterialValue, label: string, options: MaterialOptions): number {
  if (value.source === UNVERIFIED && !options.allowUnverified) throw new EngineError('INVALID_PAYLOAD', `${label} is unverified (${value.reason ?? 'no source'}); pass allowUnverified: true to use it.`);
  return value.value;
}

/** The SI value of one property. Throws when the library has none, or when it is unverified and not allowed. */
export function materialProperty(id: string, property: MaterialPropertyName, options: MaterialOptions = {}): number {
  const value = materialValue(id, property);
  if (!value) throw new EngineError('INVALID_PAYLOAD', `The library has no ${property} for "${id}".`);
  return accept(value, `${id}.${property}`, options);
}

function optional(id: string, property: MaterialPropertyName, override: number | undefined, options: MaterialOptions): number {
  if (override !== undefined) return override;
  return materialProperty(id, property, options);
}

// ---------------------------------------------------------------------------------------------------------------
// Solver inputs
// ---------------------------------------------------------------------------------------------------------------

/** The largest Poisson's ratio the solid and granular solvers accept. */
export const SOLVER_POISSON_LIMIT = 0.4999;

export interface SolidMaterialOptions extends MaterialOptions {
  readonly youngModulus?: number;
  readonly poissonRatio?: number;
  readonly density?: number;
  /** Leave the thermal expansion out (it is included when the library has it). */
  readonly thermalExpansion?: number | null;
}

/**
 * The input of `SolidBody` and `FractureBody` (solid.ts): E, nu, rho and, when the library has it, the linear
 * expansion coefficient. Poisson's ratio is capped at SOLVER_POISSON_LIMIT. Overrides replace library values.
 */
export function solidMaterial(id: string, options: SolidMaterialOptions = {}): SolidMaterial {
  const entry = material(id);
  const out: {youngModulus: number; poissonRatio: number; density: number; thermalExpansion?: number} = {
    youngModulus: optional(id, 'youngModulus', options.youngModulus, options),
    poissonRatio: Math.min(SOLVER_POISSON_LIMIT, optional(id, 'poissonRatio', options.poissonRatio, options)),
    density: optional(id, 'density', options.density, options),
  };
  if (options.thermalExpansion !== null) {
    if (options.thermalExpansion !== undefined) out.thermalExpansion = options.thermalExpansion;
    else if (entry.properties.thermalExpansion) out.thermalExpansion = accept(entry.properties.thermalExpansion, `${id}.thermalExpansion`, options);
  }
  return out;
}

/** Plane strain (a thick body: G_c = K^2 (1 - nu^2) / E) or plane stress (a thin sheet: G_c = K^2 / E). */
export type StressState = 'plane-strain' | 'plane-stress';

/** Irwin's relation between the fracture toughness K_IC (Pa m^0.5) and the energy release rate G_c (J/m^2). */
export function fractureEnergyFromToughness(toughness: number, youngModulus: number, poissonRatio: number, state: StressState = 'plane-strain'): number {
  return toughness * toughness * (state === 'plane-strain' ? 1 - poissonRatio * poissonRatio : 1) / youngModulus;
}

export interface FractureLawOptions extends MaterialOptions {
  readonly model?: FractureModel;
  /** sigma_c, Pa. Default: the library's tensile strength, else its flexural strength. */
  readonly strength?: number;
  /** G_c, J/m^2. Default: from K_IC by Irwin's relation in `state`, else the library's fracture energy. */
  readonly toughness?: number;
  /** Default 'plane-strain': K_IC is a plane-strain property, measured on thick specimens. */
  readonly state?: StressState;
}

/**
 * The fracture law of `FractureBody` (solid-fracture.ts): `strength` sigma_c and `toughness` G_c.
 * G_c comes from K_IC: K_IC^2 (1 - nu^2) / E in plane strain (the default, the state K_IC is measured in), or
 * K_IC^2 / E in plane stress for a thin sheet; the cohesive law then dissipates G_c per unit crack area.
 * When the library has no K_IC, its fracture energy is used. Throws when either value is missing.
 */
export function fractureLaw(id: string, options: FractureLawOptions = {}): FractureLaw {
  const entry = material(id), state = options.state ?? 'plane-strain';
  let toughness = options.toughness;
  if (toughness === undefined) {
    if (entry.properties.fractureToughness) {
      const K = accept(entry.properties.fractureToughness, `${id}.fractureToughness`, options);
      toughness = fractureEnergyFromToughness(K, materialProperty(id, 'youngModulus', options), Math.min(SOLVER_POISSON_LIMIT, materialProperty(id, 'poissonRatio', options)), state);
    } else if (entry.properties.fractureEnergy) toughness = accept(entry.properties.fractureEnergy, `${id}.fractureEnergy`, options);
    else throw new EngineError('INVALID_PAYLOAD', `The library has no fracture toughness or fracture energy for "${id}"; pass toughness.`);
  }
  let strength = options.strength;
  if (strength === undefined) {
    const value = entry.properties.tensileStrength ?? entry.properties.flexuralStrength;
    if (!value) throw new EngineError('INVALID_PAYLOAD', `The library has no tensile or flexural strength for "${id}"; pass strength.`);
    strength = accept(value, `${id}.strength`, options);
  }
  return {model: options.model ?? 'cohesive', strength, toughness};
}

export interface HeatMaterialOptions extends MaterialOptions {
  readonly conductivity?: number;
  readonly density?: number;
  readonly specificHeat?: number;
}

/** The input of `HeatSolver` (heat.ts): conductivity k, density rho and specific heat c_p. */
export function heatMaterial(id: string, options: HeatMaterialOptions = {}): HeatMaterial {
  return {
    conductivity: optional(id, 'thermalConductivity', options.conductivity, options),
    density: optional(id, 'density', options.density, options),
    specificHeat: optional(id, 'specificHeat', options.specificHeat, options),
  };
}

/** Thermal diffusivity k / (rho c_p), m^2/s. */
export function thermalDiffusivity(id: string, options: MaterialOptions = {}): number {
  const m = heatMaterial(id, options);
  return m.conductivity! / (m.density * m.specificHeat);
}

export interface ContactPairValues {
  readonly a: string;
  readonly b: string;
  readonly condition: ContactCondition;
  readonly staticFriction: number | null;
  readonly kineticFriction: number | null;
  /** The one Coulomb coefficient the rigid world applies to both sticking and sliding (see `contactPair`). */
  readonly friction: number | null;
  readonly restitution: number | null;
  readonly impactSpeed: readonly [number, number] | null;
  readonly entries: readonly ContactPairEntry[];
}

export interface ContactPairOptions extends MaterialOptions {
  /** Which coefficient becomes `friction`: 'static' (default) or 'kinetic'. */
  readonly use?: 'static' | 'kinetic';
}

/** Every pair entry for a and b in this condition (either order). */
export function contactPairEntries(a: string, b: string, condition: ContactCondition = 'dry'): ContactPairEntry[] {
  material(a); material(b);
  return CONTACT_PAIRS.filter(pair => pair.condition === condition && ((pair.a === a && pair.b === b) || (pair.a === b && pair.b === a)));
}

/**
 * Friction and restitution between two library materials, in either order, for a condition ('dry' by default).
 * The rigid world has one Coulomb coefficient per contact for sticking and sliding alike; `friction` is the static
 * coefficient by default (what holds still in reality holds still; sliding then dissipates mu_s / mu_k times too
 * much), or the kinetic one with `use: 'kinetic'`, or the source's unqualified coefficient when it gives neither.
 * Box3D mixes two bodies' coefficients as sqrt(f_a f_b) for friction and max(e_a, e_b) for restitution, so to get
 * this pair's value between bodies of different materials, give both bodies these numbers (or set a friction callback).
 * Throws when the library has no entry for the pair.
 */
export function contactPair(a: string, b: string, condition: ContactCondition = 'dry', options: ContactPairOptions = {}): ContactPairValues {
  const entries = contactPairEntries(a, b, condition);
  if (!entries.length) throw new EngineError('INVALID_PAYLOAD', `The library has no ${condition} contact entry for "${a}" and "${b}".`);
  const pick = (key: 'staticFriction' | 'kineticFriction' | 'friction' | 'restitution'): MaterialValue | null => {
    let found: MaterialValue | null = null;
    for (const entry of entries) if (entry[key] && (!found || (found.source === UNVERIFIED && entry[key]!.source !== UNVERIFIED))) found = entry[key]!;
    return found;
  };
  const read = (value: MaterialValue | null, label: string): number | null => value === null ? null : (value.source === UNVERIFIED && !options.allowUnverified ? null : accept(value, label, options));
  const label = `${a}/${b} (${condition})`;
  const staticFriction = read(pick('staticFriction'), `${label} static friction`), kineticFriction = read(pick('kineticFriction'), `${label} kinetic friction`);
  const plain = read(pick('friction'), `${label} friction`), restitutionValue = pick('restitution');
  const restitution = read(restitutionValue, `${label} restitution`);
  const preferred = options.use === 'kinetic' ? kineticFriction ?? staticFriction : staticFriction ?? kineticFriction;
  const holder = restitution === null ? null : entries.find(entry => entry.restitution === restitutionValue);
  return {a, b, condition, staticFriction, kineticFriction, friction: preferred ?? plain, restitution, impactSpeed: holder?.impactSpeed ?? null, entries};
}

export interface RigidMaterialValues {
  readonly density: number;
  readonly friction: number;
  readonly restitution: number;
  /** The pairs the two coefficients were taken from. */
  readonly frictionPair: readonly [string, string, ContactCondition];
  readonly restitutionPair: readonly [string, string, ContactCondition];
  /** Which of the three values are unverified. */
  readonly unverified: readonly ('density' | 'friction' | 'restitution')[];
}

export interface RigidMaterialOptions extends MaterialOptions {
  /** The pair whose friction is used. Default: the material on itself, dry. */
  readonly frictionPair?: readonly [string, string, ContactCondition?];
  /** The pair whose restitution is used. Default: the material on itself (any condition). */
  readonly restitutionPair?: readonly [string, string, ContactCondition?];
  readonly use?: 'static' | 'kinetic';
}

/** The density, friction and restitution of one rigid body made of a library material (a `SceneMaterial`). */
export function rigidMaterial(id: string, options: RigidMaterialOptions = {}): RigidMaterialValues {
  const unverifiedKeys: ('density' | 'friction' | 'restitution')[] = [];
  const densityValue = materialValue(id, 'density');
  if (!densityValue) throw new EngineError('INVALID_PAYLOAD', `The library has no density for "${id}".`);
  if (densityValue.source === UNVERIFIED) unverifiedKeys.push('density');
  const density = accept(densityValue, `${id}.density`, options);
  const coefficient = (pair: readonly [string, string, ContactCondition?] | undefined, key: 'friction' | 'restitution'): [number, readonly [string, string, ContactCondition]] => {
    const conditions: ContactCondition[] = pair?.[2] ? [pair[2]] : key === 'friction' ? ['dry'] : ['dry', 'wet', 'lubricated'];
    const [a, b] = pair ? [pair[0], pair[1]] : [id, id];
    for (const condition of conditions) {
      const entries = contactPairEntries(a, b, condition);
      if (!entries.length) continue;
      const strict = contactPair(a, b, condition, {...options, allowUnverified: false});
      const loose = contactPair(a, b, condition, {...options, allowUnverified: true});
      const value = key === 'friction' ? strict.friction ?? loose.friction : strict.restitution ?? loose.restitution;
      if (value === null) continue;
      if ((key === 'friction' ? strict.friction : strict.restitution) === null) {
        if (!options.allowUnverified) throw new EngineError('INVALID_PAYLOAD', `The ${key} of ${a}/${b} (${condition}) is unverified; pass allowUnverified: true to use it.`);
        unverifiedKeys.push(key);
      }
      return [value, [a, b, condition]];
    }
    throw new EngineError('INVALID_PAYLOAD', `The library has no ${key} for ${a}/${b}; pass ${key}Pair.`);
  };
  const [friction, frictionPair] = coefficient(options.frictionPair, 'friction');
  const [restitution, restitutionPair] = coefficient(options.restitutionPair, 'restitution');
  return {density, friction, restitution, frictionPair, restitutionPair, unverified: unverifiedKeys};
}

export interface GrainMaterialOptions extends MaterialOptions {
  readonly restitution?: number;
  readonly friction?: number;
  readonly rollingFriction?: number;
  readonly youngModulus?: number;
  readonly poissonRatio?: number;
  readonly density?: number;
}

/**
 * The input of `Granular` (granular.ts) for the Hertz law: density, E, nu (capped at SOLVER_POISSON_LIMIT), and
 * the grain-on-grain friction and restitution of the material on itself. Throws when the library has no friction
 * or restitution for the material on itself and none is passed.
 */
export function grainMaterial(id: string, options: GrainMaterialOptions = {}): GranularMaterial {
  const self = contactPairEntries(id, id, 'dry').length ? contactPair(id, id, 'dry', {...options, use: 'kinetic'}) : null;
  const friction = options.friction ?? self?.friction ?? null, restitution = options.restitution ?? self?.restitution ?? null;
  if (friction === null) throw new EngineError('INVALID_PAYLOAD', `The library has no grain-on-grain friction for "${id}"; pass friction.`);
  if (restitution === null) throw new EngineError('INVALID_PAYLOAD', `The library has no grain-on-grain restitution for "${id}"; pass restitution.`);
  return {
    density: optional(id, 'density', options.density, options),
    youngModulus: optional(id, 'youngModulus', options.youngModulus, options),
    poissonRatio: Math.min(SOLVER_POISSON_LIMIT, optional(id, 'poissonRatio', options.poissonRatio, options)),
    restitution, friction,
    ...(options.rollingFriction === undefined ? {} : {rollingFriction: options.rollingFriction}),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------------------------------------------

export interface ShearConsistency {
  readonly id: string;
  /** G as the source states it, Pa. */
  readonly stated: number;
  /** E / (2 (1 + nu)) from the stated E and nu, Pa. */
  readonly isotropic: number;
  /** stated / isotropic - 1. */
  readonly relative: number;
  /** True when the entry flags the disagreement. */
  readonly flagged: boolean;
}

/** For an isotropic entry with E, nu and G: how far the stated G is from E / (2 (1 + nu)). Null otherwise. */
export function shearConsistency(id: string): ShearConsistency | null {
  const entry = material(id), {youngModulus: E, poissonRatio: nu, shearModulus: G} = entry.properties;
  if (!entry.isotropic || !E || !nu || !G) return null;
  const isotropic = E.value / (2 * (1 + nu.value));
  return {id, stated: G.value, isotropic, relative: G.value / isotropic - 1, flagged: (entry.flags ?? []).some(flag => /shear modulus/i.test(flag))};
}

export interface MaterialAuditRow {
  readonly kind: 'property' | 'pair';
  readonly subject: string;
  readonly property: string;
  readonly value: number;
  readonly source: string;
  readonly reason?: string;
}

/** Every value in the library, one row each, in library order. */
export function materialAudit(): MaterialAuditRow[] {
  const rows: MaterialAuditRow[] = [];
  for (const entry of Object.values(MATERIALS)) for (const [property, value] of Object.entries(entry.properties) as [MaterialPropertyName, MaterialValue][])
    rows.push({kind: 'property', subject: entry.id, property, value: value.value, source: value.source, ...(value.reason ? {reason: value.reason} : {})});
  for (const pair of CONTACT_PAIRS) for (const key of ['staticFriction', 'kineticFriction', 'friction', 'restitution'] as const) {
    const value = pair[key];
    if (value) rows.push({kind: 'pair', subject: `${pair.a}/${pair.b} (${pair.condition})`, property: key, value: value.value, source: value.source, ...(value.reason ? {reason: value.reason} : {})});
  }
  return rows;
}
