# Glass contact mechanics

## 2026-09-25: paired sliding update now supported by readbacks

[Six-contact staleness audit](../benchmarks/experiments/glass-tick117-sliding-staleness-20260925-01/README.md)
passes 79 controls and 18 independent readbacks. Only contacts 5955 and 5956
exceed the 1e-8 m/s diagnostic vector-error threshold, at 9.8392e-7 and
9.3912e-7 m/s. The frozen rule proposes those two for a single future joint
relinearization; no solve or new candidate was made here. Contact 5965's
normal error is a lower/closing-velocity violation at both saved points; its
selected upper already chooses the smaller term. Current best stays
1.0723882378867055e-6 m/s, above the 1e-6 target. Production, accepted replay
tick 116, current-v5 and performance qualification are unchanged.


## 2026-09-25: targeted sliding derivative checked; candidate rejected

[Contact 5956 readback and single update](../benchmarks/experiments/glass-tick117-contact5956-relinearize-20260925-01/README.md)
confirms a 9.3912e-7 m/s vector error in its old affine friction approximation
at the current best. All 54 controls passed. Exactly two tail rows changed;
97,199 other rows, the coordinate origin, bounds, phase cap and physical gates
were retained. The 96-digit result is 1.0730351588782279e-06 m/s,
worse than the preserved 1.0723882378867055e-06 m/s best and
above the 1e-6 target. No candidate was applied. A fresh exact local-model
certificate has residual floor 1.0552667530679681e-06 m/s;
it is not a physical nonexistence proof. The next bounded check measures the
other five suspect sliding approximations before any joint update. No runtime
speedup or current-v5 qualification; accepted replay remains tick 116.


## 2026-09-25: complete friction-cone influence verified

The closed offline packet `benchmarks/experiments/glass-tick117-friction-cone-influence-20260925-01` passed 118 controls and independently scored all 5,918 complete friction residual cones in the saved no-trust model. Removing one cone remains excluded from the target in 5,815 cases; 103 are inconclusive (97 sticking/slow and 6 sliding). The independent column traversal checked 139,302 candidate nonzeros, and five full certificates included exact reproduction of the rejected contact-5967 relaxation. All normal, impulse-cone, energy, momentum and finite-domain constraints were preserved. These results concern individual fixed-model relaxations, not physical nonexistence or feasibility.

The frozen strongest-weakening selection is contact 5521, but 96-digit original-law diagnostics put it far inside the sticking disk. The strongest sliding case, 5956, stays sliding and has physical friction residual margin at both existing points. Next: compare its stored affine approximation with the original law, then consider a validated single-contact Jacobian update in unchanged coordinates and bounds. Zero new solves/candidates, no best update or physical application. Best remains 1.0723882378867055e-06 m/s; production and accepted replay tick 116 unchanged. Current-v5 and performance qualification remain open.

## 2026-09-25: contact 5967 release rejected

The closed offline packet `benchmarks/experiments/glass-tick117-contact5967-release-audit-20260925-01` passed 40 controls and independently checked two direct releases at 96-digit precision. Full residuals were 1.6449694889025432e-06 and 1.6434997623967144e-06 m/s; both fail the 1e-6 target and worsen the preserved best 1.0723882378867055e-06 m/s. Energy, normal-impulse, physical cone and momentum side gates passed. The released contact itself passes, but its coupled response worsens other contacts.

Removing only its complete sliding-residual cone leaves an exact phase lower bound 0.0550917827790172 above target 0.009324091333603811. This excludes only the fixed local relaxation. Exact witness readbacks verified 1,818 momentum equations and all retained cones/domains per point; tiny affine impulse-cone discrepancies are separate from the larger original-law failure. Zero optimization solves, no best update or physical application, unchanged production and accepted replay tick 116. Next: score individual complete friction residual cones using the existing full dual; avoid repeating broad family-removal solves. Current-v5 trajectory and performance qualification remain open.

## 2026-09-25 — all-normal influence checked; zero-step switch rejected

The [new-dual influence audit](../benchmarks/experiments/glass-tick117-no-trust-normal-influence-20260925-01/README.md)
passed 134 controls and independently checked all 6,023 normal upper removals
with no baseline zeroing. Exactly 5,963 one-row relaxations remain excluded;
60 are inconclusive. The fixed selection rule proposes impulse-branch contact
5967. All 64,795 candidate coefficients, exact rankings, and five complete spot
certificates were independently verified. The stored model anchor and newer
comparison best were kept distinct.

A separate exact post-result assessment finds that none of the 60 alternate
uppers fits a zero-step witness under the existing phase cap. Contact 5967 needs
phase 246.43213796299119, versus cap 1.0000923085042026; its anchor normal velocity is
0.00026528614334091107 m/s. No bound was expanded. This is not proof of nonzero-step or
physical infeasibility. The contact is separating and sliding, so the next
bounded zero-solve audit will assess exact zero-impulse release, its retained
normal constraints, coupled physical response and a possible nonzero witness.
No new physical point or optimization solve was produced here. The measured best
remains 1.0723882378867055e-06 m/s against 1e-6. Production,
accepted replay tick 116 and all current-v5/performance gates are unchanged.


## 2026-09-25 — small measured improvement without sliding trust constraints

The [bounded no-trust trial](../benchmarks/experiments/glass-tick117-no-sliding-trust-20260925-01/README.md)
passed 210 controls, two small physical fixtures and an independent 96-digit
check. Its full residual improved from 1.0724905668023452e-06 to
**1.0723882378867055e-06 m/s**, a 0.009541% reduction. It still exceeds the unchanged
1e-6 target by 7.238824% and was not applied. Energy, impulse-cone, nonnegative
impulse and momentum side checks pass; all 6,023 normals were independently read
back. Normal/friction violations are 220/345. The new measured point is recorded
in the packet's `best-measured.json`, separate from its earlier matrix anchor.

Only 4,264 sliding trust/domain rows were removed. All 6,023 normal upper and
lower rows, impulse cones, energy, objectives, witness and finite bounds remain
unchanged; the matrix has 97,201 rows, 19,888 columns and 546,460 nonzeros. The
fresh exact dual now gives phase lower bound 0.055093732908902397
and nominal floor 1.0490875088388996e-06 m/s, excluding
the target in this fixed no-trust model. This strengthens the prior inconclusive
inherited certificate but proves no physical nonexistence or branch-family
exclusion. No speedup or current-v5 qualification is claimed. Next: rank normal
row influence from this fresh dual without repeating the same solve. Production
and accepted replay tick 116 are unchanged.


## 2026-09-25 — fresh-anchor constraint-support audit

The [zero-solve support audit](../benchmarks/experiments/glass-tick117-new-anchor-support-audit-20260925-01/README.md)
passed 159 controls and independent exact checks for three prescribed removals:
6,023 normal upper rows, 4,264 sliding trust/domain rows, and their 10,287-row
union. Their modified dual certificates all reduce to phase lower bound zero,
below target phase 0.0093240913336038109. This is inconclusive; it does not prove
feasibility or that either constraint family causes the physical error.
The complete and six-upper source exclusions were reverified and still hold.

Every changed and retained multiplier, complete Lorentz-group removal, all
39,776 retained domain-premise rows, and all 587,255 sparse entries were checked.
No new primal solve or physical candidate was produced. The measured best remains
1.0724905668023452e-06 m/s against 1e-6 m/s. No old-anchor
branch-family conclusion, physical nonexistence, accuracy gain, or speedup is
claimed. Next: one bounded solve removing only sliding trust/domain rows while
retaining all normal upper constraints and every original physical acceptance
gate. Production and accepted replay tick 116 are unchanged.


## 2026-09-25 — rebuilt best-anchor model independently checked

The new [bounded reanchor experiment](../benchmarks/experiments/glass-tick117-new-best-anchor-20260925-01/README.md)
passed 187 controls, two small physical fixture solves, one captured solve and
an independent 96-digit check. Its full residual is
1.0726767266470328e-06 m/s, slightly worse than the retained
1.0724905668023452e-06 m/s best; it fails the unchanged 1e-6 m/s gate and was not applied.
The candidate passes energy, impulse-cone, nonnegative impulse and momentum
side checks. All 6,023 normals were independently read back. Normal/friction
violation counts are 228/350, but the maximum-error acceptance gate controls.

The full and curvature-projected models were freshly rebuilt and saved at the
pinned best impulse. Five diagnostic slow/anchor-sticking classifications
changed; normal branches and solver sliding/sticking masks did not. Conservative
rounding at impulse contact 5952, forced impulses 5511/5952, and finite domains
were independently checked without changing the witness. Two fresh exact phase
bounds, 0.061220534727001744 and
0.061219625170601616, exceed target phase
0.0093240913336038109 for the complete projected model and its
six-upper relaxation. These exclude only their saved local models. No old-anchor
certificate or 128-choice conclusion is reused, and physical nonexistence is not
proved. Production and accepted replay tick 116 remain unchanged; no speedup or
current-v5 release qualification is claimed. Next: audit restriction support in
the fresh dual before any further primal solve.


## 2026-09-25 — New measured best; old-anchor family excluded without curvature

The one captured projected-impulse solve produced a verified new measured best: full original-law residual **1.0724905668023452e-6 m/s**, down from 1.0728677764183548e-6 m/s (**0.035159%** improvement). The independent 96-digit checker confirms energy, cone, normal-sign and momentum side gates. The point remains **7.249057% above** the 1e-6 target, with 244 normal and 398 friction violations. It is retained as an unqualified measured candidate, not applied to production. All 161 controls, two small physical fixtures and the separate review passed.

The fresh exact phase bounds are **0.05666476035659894** for the complete projected model and **0.05667435420125686** after zeroing six upper multipliers, both above target 0.009319608377993135. With the independently reverified projected velocity half, this excludes **all 128 stored branch choices even without curvature**, at the original anchor with other envelopes and bounds fixed. This is not a physical nonexistence proof.

The new measured reference is `glass-tick117-impulse-projected-solve-20260925-01/candidate-vectors.npz`, array `projected_impulse`, SHA256 `3626d878db85a51c88df6ca8136b43df546750b6e96c7200424777e6712e8454`. The earlier best and all source evidence remain intact. Next: rebuild the approximation at this new anchor under unchanged physical and solver rules; do not repeat the excluded old-anchor family or reuse its certificates for a new anchor. Production and accepted replay tick 116 are unchanged. Current-v5 application, trajectory and performance qualification remain open. [Evidence and next experiment](../benchmarks/experiments/glass-tick117-impulse-projected-solve-20260925-01/README.md).


## 2026-09-25 — Curvature-relaxed impulse-half certificate is inconclusive

The contact-5952 impulse model was projected onto 19,888 physical/phase coordinates by removing 5,330 curvature rows and 1,066 auxiliaries. The persisted matrix has 101,465 rows and 587,255 sparse entries. Independent checks verified every retained expression and finite-domain premise, restricted the already lifted rational dual without new scaling, and then zeroed the six other selected upper multipliers. All **159 controls** and the separate review passed. There were **zero optimization solves or physical candidates**.

The new exact raw phase lower bound is **-6.782648478343626**; its nonnegative certified bound is **0**, below target 0.009319608377993135. This saved dual is therefore **inconclusive**, not a feasibility proof. The reverified projected velocity-half bound still excludes its 64 choices. Exclusion of all 128 choices without curvature remains unproven. The earlier all-128 exclusion with the full original envelopes remains valid.

Next: one bounded primal solve of the complete persisted impulse projection, keeping its six selected upper rows and contact 5952 on impulse. Evaluate every original physical condition and then use the new dual for both the complete model and the six-row relaxation. Production, accepted replay tick 116 and the unqualified measured best residual of 1.0728677764183548e-6 m/s remain unchanged. No performance gain or current-v5 qualification is claimed. [Evidence and next experiment](../benchmarks/experiments/glass-tick117-impulse-curvature-audit-20260925-01/README.md).


## 2026-09-25 — All 128 choices in the seven-contact branch family excluded

The independent exact audit excludes all **128 stored-model branch choices** at contacts 5511, 5513, 5515, 5516, 5531, 5532 and 5952 while the other anchor, envelopes and bounds remain fixed. For the 5952-impulse half, zeroing only the six other normal-upper dual multipliers gives phase lower bound **0.0676338760626525**, above target 0.009319608377993135 (nominal model floor 1.0625715859717447e-6 m/s). Contact 5952's impulse upper and all 1,066 curvature auxiliaries remain. The earlier velocity-half certificate was reverified from its matrices, domain premises and full exact contributions: lower bound **0.05993413055436485**, already excluding its 64 choices after curvature removal.

All **103 controls** and the separate review passed. The new proof checked 106,789 retained multipliers, 20,954 finite domains, 42,974 retained domain-premise rows and 616,576 sparse entries; independent CSR/CSC traversals agreed. There were **zero new optimization solves or physical candidates**. This excludes only the fixed stored model family; it does not prove physical nonexistence or a runtime speedup. The impulse half still retains curvature, so exclusion of all 128 choices without curvature has not been established.

Production, the measured best residual of 1.0728677764183548e-6 m/s and accepted replay tick 116 are unchanged. The original-law accuracy, current-v5 application/trajectory and performance gates remain open. Next: project curvature out of the impulse half and independently check its restricted exact dual before another primal solve. [Evidence and next experiment](../benchmarks/experiments/glass-tick117-seven-branch-union-20260925-01/README.md).


## 2026-09-25 — Contact 5952 impulse trial rejected

The complete original 106,795-row contact model was solved with only contact 5952 changed from its velocity upper to a conservatively rounded impulse upper. All 109 controls, two small physical fixtures and the independent 96-digit/exact-certificate review passed. The captured candidate failed the full physical target: residual **1.0734900716891099e-6 m/s**, worse than the retained **1.0728677764183548e-6 m/s** best. Contact 5952 itself now passes at 9.113761633204378e-7 m/s, but 237 normal and 402 friction contacts remain above target.

The exact fixed-model phase lower bound is **0.06764192975028716**, above the target 0.009319608377993135 (nominal floor 1.0625802276306086e-6 m/s). Every other row, all 1,066 curvature auxiliaries and all 41,908 domain endpoints were preserved. The original witness phase stayed unchanged. No candidate was promoted or applied; accepted replay remains tick 116. This excludes the frozen model, not physical feasibility. No performance gain is claimed.

Next: use the new repaired dual to audit all 64 choices at the six earlier contacts while retaining 5952 on impulse. Combined with the existing velocity-half certificate, a positive bound would exclude all 128 choices at these seven contacts before further primal trials. [Evidence and next experiment](../benchmarks/experiments/glass-tick117-contact5952-impulse-20260925-01/README.md).


## 2026-09-25 — 6,017 exact influence scores select contact 5952

The frozen `glass-tick117-normal-certificate-influence-20260925-01` audit scores
every remaining selected normal-upper row relative to the six-row-zero exact
certificate. Of 6,017 additional single-row removals, 5,963 corresponding
relaxations remain excluded and 54 are inconclusive. Independent CSR/CSC paths
agree on every score, all 64,787 touched coefficients, rankings and the selection
rule frozen before execution. All 118 controls and four full certificate spot
checks pass. No optimization solver runs and no physical candidate is created.

The rule selects contact 5952. Its stored original velocity term is
1.0645334085898183e-6 m/s and its normal diagonal-times-impulse term is
1.0681453182164085e-6 m/s. The alternate impulse upper exceeds the target by
6.814531821640855e-8 m/s, the smallest excess among inconclusive cases. The exact
relaxed phase bound becomes 0.0004002863966958786, below target
0.009319608377993135. This is a supported hypothesis, not evidence of feasibility.
The next complete-model trial will switch only contact 5952 to the impulse branch
at the original anchor, preserving the original six choices and every other row,
friction envelope, curvature auxiliary, domain and bound.

Full spot checks at contacts 5959, 5235, 5952 and 2992 independently recheck every
matrix entry, constant, gradient and domain-minimum contribution. All 39,776
finite-domain premise rows remain retained. The sparse scoring pass takes
2.151815 seconds excluding input loading, serialization, complete certificates
and verification; this is diagnostic timing, not an engine speedup. Peak
completed child memory is 352,480 KiB. All children and samplers stop, and four
owned empty temporary directories are removed. The closure records actual bytes
against the 24 MiB output budget.

The stored anchor terms are exact source readbacks/products, not a new physical
oracle. No promotion, application, current-v5 trajectory or runtime performance
qualification is claimed. The measured low remains 1.0728677764183548e-6 m/s,
above the unchanged 1e-6 gate. Production and accepted replay tick 116 are
unchanged. See the packet's README.md, PROOF.md, NEXT.md and closure-audit.json.
All previous content below is preserved.


## 2026-09-25 — all 64 choices at the six contacts exactly excluded

The frozen `glass-tick117-six-branch-union-20260925-01` audit verifies a common
relaxation containing all 64 impulse/velocity choices at contacts 5511, 5513,
5515, 5516, 5531 and 5532. It compares the actual original and six-velocity full
matrices outside those rows, verifies each alternate row, and independently
rechecks the curvature projection. Removing the six mapped scalar upper rows
then relaxes every one of those complete fixed models.

Zeroing only those six exact dual multipliers gives a verified phase lower bound
of 0.05993413055436485, above target 0.009319608377993135. The nominal model
residual floor is 1.0543097092962512e-6 m/s. All 64 choices therefore fail to reach
the target with the remaining envelopes and bounds fixed, even without the
curvature penalty. This rules out that local branch search; it does not prove
physical nonexistence or qualify a new physical state.

All 73 controls and the independent captured certificate check pass. Every
constant, sparse entry, gradient and interval-minimum contribution is checked.
The audit retains all 19,888 finite domains and their 39,776 premise rows,
verifies six zero multipliers and 101,459 unchanged multipliers, and runs zero
optimization solves. It creates no physical candidate. Peak completed child
memory is 276,208 KiB. Four owned empty temporary directories are removed after
all children and samplers stop; the 12 MiB output budget and actual retained
bytes are recorded in the closure.

The next audit will rank the exact effect of additionally removing each of the
6,017 remaining selected normal-upper rows from this certificate. Sparse updates
can identify a different supported trial before further optimization solves.
An inconclusive certificate will remain inconclusive; its score alone cannot
prove feasibility or physical importance.

The measured low remains 1.0728677764183548e-6 m/s, above the unchanged 1e-6 gate.
Production, original reference and accepted replay tick 116 are unchanged. No
current-v5 trajectory, application or runtime speedup is claimed. See the
packet's README.md, PROOF.md, NEXT.md and closure-audit.json. All previous
content below is preserved.


## 2026-09-25 — complete six-contact branch trial rejected

The frozen `glass-tick117-six-normal-branches-20260925-02` trial changes only six
selected normal uppers to velocity branches at the original anchor. It retains
all 106,795 rows, 20,954 variables, friction constraints and 1,066 curvature
auxiliaries. Every retained row, new branch coefficient, conservative head
constant, objective and all 41,908 finite-domain endpoints verify independently.
The revised witness phase 0.8085186191410315 fits the unchanged 1.0000922641229422
upper bound. Original forced-impulse provenance and effective selection are
recorded separately.

All 51 controls and two small physical solves pass. The captured candidate's
original residual is 1.1306087224235115e-6 m/s, worse than the retained measured
low of 1.0728677764183548e-6 m/s. It fails 226 normal and 434 friction checks.
The independent exact phase bound is 0.098459412201101 versus target
0.009319608377993135, giving a nominal model floor of 1.0956475854002598e-6 m/s.
This excludes only this fixed model. The candidate is rejected; no promotion,
physical application or physical nonexistence claim follows.

Contacts 5531 and 5532 pass the original law through the previous impulse
alternative while their new velocity uppers fail. The next audit will remove
all six selected upper rows from the saved curvature-projected model and check
its exact certificate. If that relaxation is excluded, none of the 64 choices
at these six contacts can meet the target with the remaining envelopes and
bounds fixed. A weak certificate remains inconclusive.

The first immutable attempt stopped at a small sliding fixture before any
captured solve. The corrected fixture starts at its analytical Coulomb solution
and retains metrics before asserting acceptance; tolerances and the captured
trial are unchanged. Across both attempts, four small and one captured solve
calls returned. The successful packet has 510,384 KiB peak child memory; all
children and samplers stop, and four owned empty temporary directories are
removed. Its closure records hashes and actual bytes against the 24 MiB budget.

Production, the measured low and accepted replay tick 116 remain unchanged.
No runtime speedup, current-v5 trajectory or application qualification is claimed.
See the packet's README.md, PROOF.md, NEXT.md and closure-audit.json. All previous
content below is preserved.


## 2026-09-25 — full friction passes after selected-normal relaxation; candidate rejected

The frozen `glass-tick117-selected-normal-relaxation-20260925-01` experiment
removes only the 6,023 selected normal-upper rows from the original full matrix.
All friction constraints, 1,066 curvature auxiliaries, normal-lower bounds,
nonnegative normal impulses, impulse cones, momentum, energy, movement boxes and
phase bounds remain. Independent checks verify every retained expression and
all 41,908 finite-domain endpoints. All 40 controls, two small solves, one captured
solve and the separate review pass.

The candidate meets the complete original friction target at
9.478276067029442e-7 m/s, with no friction class above 1e-6. It fails the original
normal-contact law at 1,414 contacts: normal/full residual is
0.02075008392514283 m/s. It is rejected, with zero promotions or physical
applications. The exact phase lower bound is zero and inconclusive; solver status
and a small floating-point cone residual do not prove exact primal feasibility.

The independent 80/96-digit readback checks both normal branch terms for all
6,023 contacts. Six contacts — 5511, 5513, 5515, 5516, 5531 and 5532 — satisfy the
original normal law through the velocity alternative while their previous
selected impulse upper bounds fail. This supports a joint six-contact branch
trial in the complete original model; it does not establish necessity or
sufficiency. Contact 5511 alone was already excluded by the preceding audit.

The measured low remains 1.0728677764183548e-6 m/s, above the unchanged target.
Peak completed child memory is 484,240 KiB. Production and accepted replay tick
116 are unchanged. No current-v5 trajectory qualification, engine speedup or
physical nonexistence is claimed. The packet records all source/result hashes,
resource bounds and cleanup. See its README.md, PROOF.md, NEXT.md and
closure-audit.json. All previous content below is preserved.


## 2026-09-25 — remaining certificate support isolated

The frozen `glass-tick117-certificate-support-20260925-01` audit runs zero new
optimization solves and creates no physical candidate. All 41 controls and four
independent exact certificate checks pass. It zeroes prescribed dual multipliers
in the saved curvature-projected model, verifies every removal/retained multiplier,
and preserves all 19,888 finite domains and their 39,776 premise rows.

Removing all 4,264 sliding trust/domain rows still excludes the target: the exact
phase bound is 0.05837320566023943 versus target 0.009319608377993135. Removing
only contact 5511's selected normal-upper row also still excludes it, with bound
0.059912742381062555. Either removal alone is insufficient, even without curvature.
Removing all 6,023 selected normal-upper rows, with or without sliding trust/domain
rows, makes this chosen certificate inconclusive; the strengthened bound is zero.
This is not evidence of feasibility or proof that normal selection is the sole
cause. Analytical controls demonstrate that distinction explicitly.

The next captured solve will remove selected normal-upper rows while retaining
the full original friction constraints, including curvature and auxiliaries. It
will check every original physical law and report the normal branch terms at
violating contacts. This is distinct from the previous experiment that removed
friction envelopes while retaining selected normal branches.

The measured low remains 1.0728677764183548e-6 m/s, above the unchanged 1e-6 target.
Peak completed child memory is 258,032 KiB. Production, physical state, reference
promotion and accepted replay tick 116 are unchanged; no runtime speedup,
current-v5 replay qualification or physical nonexistence is claimed. See the
packet's README.md, PROOF.md, NEXT.md and closure-audit.json. All previous
content below is preserved.


## 2026-09-25 — sliding curvature is not the sole target restriction

The frozen `glass-tick117-curvature-projection-20260925-01` experiment removes only
5,330 sliding-curvature rows and 1,066 auxiliaries from the original saved full
stage-3 matrix. Its independent projection proof checks all 3,198 auxiliary
occurrences and every retained expression; all 19,888 remaining variables have
verified finite bounds. Contact modes, sliding trust/domain constraints, momentum,
energy, impulse cones and physical movement boxes remain.

All 39 controls, two small solves, one captured solve and independent 80/96-digit
physical checks pass as experiments. The exact phase lower bound is
0.059912439123595874, above target 0.009319608377993135, so removing curvature alone
is insufficient in this frozen model. The nominal model floor is
1.0542864342508962e-6 m/s; this is not a physical nonexistence proof.

The candidate's full physical residual is 1.0734247272988864e-6 m/s and it is
rejected. The measured low remains 1.0728677764183548e-6 m/s, still above the
unchanged 1e-6 target. Peak completed child memory is 477,792 KiB. There is no
production change, reference promotion, physical application, current-v5 replay
qualification or engine speedup claim. Accepted replay remains tick 116.

Next, test the support of the remaining exact exclusion certificate by zeroing
dual multipliers for selected normal-upper and sliding trust/domain constraints.
This first diagnostic needs no new QP solve; an inconclusive bound must not be
reported as feasibility. See the packet's README.md, PROOF.md, NEXT.md and
closure-audit.json. All previous documentation below is preserved.


## 2026-09-25 — Tighter general friction bound does not beat the measured best

The [general-disk branch experiment](../benchmarks/experiments/glass-tick117-general-disk-branch-20260925-01/README.md) verifies a tighter sufficient residual cone at **21 contacts**: six sticking and fifteen slow-sliding. All **80 controls**, two small physical solves, **126 exact endpoint implications**, captured **80/96-digit** readback and independent review pass. All other saved constraints, objective entries and finite domains remain unchanged.

The candidate's full residual is **1.0728859039106495e-6 m/s**, slightly worse than the retained measured low **1.0728677764183548e-6 m/s**. It is rejected for promotion. The exact phase lower bound **0.0648843445533152** exceeds the **0.009319608377993135** target, excluding that target within this approximation. This is not physical nonexistence. The next controlled test will isolate sliding-curvature majorants while retaining the remaining fixed-mode restrictions and original physical acceptance checks.

This packet ran **three solves** and peaked at **494,864 KiB**, within the unchanged 1 GiB limit. Production, both prior reference files and accepted **tick 116** are unchanged. No candidate was applied, no current-v5 trajectory was qualified and no engine speedup is claimed. The broader optimization goal remains incomplete.


## 2026-09-25 — Sufficient friction branch lowers experimental error slightly

The [small-impulse branch experiment](../benchmarks/experiments/glass-tick117-small-impulse-branch-20260925-03/README.md) replaces fourteen slow-sliding velocity cones with a sufficient friction bound, preserving all other saved constraints and verifying its coefficient rounding exactly. All **44 controls**, two small physical solves, captured **80/96-digit** readback and independent review pass. The new experimental residual is **1.0728677764183548e-6 m/s**, a **0.0129248% improvement**, still **7.28678% above** the original target. Cone, energy, nonnegative-impulse and momentum side gates pass. No candidate is applied or promoted.

An exact phase lower bound of **0.06260348270280981** still exceeds the **0.009319608377993135** target, excluding the target in this approximation. The next bounded test will examine the tighter general disk bound while retaining every original physical gate. The prior six-sticking/fifteen-slow-sliding eligibility counts describe that general bound, not the stricter two-radius bound used in this packet.

The offline builder now collects compact CSR row slices before CSC assembly; the full experiment peaks at **483.90625 MiB**, below the unchanged 1 GiB limit. Earlier frozen attempts retain a native-handle fixture failure and a memory-limit failure. This successful packet ran three solves; the memory-limited attempt may have completed up to two additional small solves but saved no completed check receipt. No engine frame-rate gain is claimed. Production, the original reference file and accepted **tick 116** remain unchanged; current-v5 replay and the broader optimization goal remain unqualified.


## 2026-09-25 — Exact witnesses locate the joint friction restriction

The [primal-certificate audit](../benchmarks/experiments/glass-tick117-family-primal-certificates-20260925-01/README.md) proves exact target feasibility of both partial frozen models. All **49 controls**, six captured primal checks and independent column-wise rational readbacks pass, with **zero new solves**. Each boundedly repaired base satisfies every retained constraint at half the original target phase. Combined with the earlier full-model exclusion, this locates a joint restriction in the sticking/sliding approximation; it is not physical nonexistence or current-v5 qualification.

Independent **80/96-digit** checks of all **6,023 contacts** in each original physical candidate locate the reference's friction-target exceedances at **443 sticking and nine sliding contacts**. Removing sticking produces 3,715 exceedances across sticking/slow-sliding contacts; removing sliding produces 372 sliding exceedances. Neither candidate passes the full law. The repaired rational witnesses are separate from these original physical candidates.

The best residual remains **1.0730064606260127e-6 m/s**, production is unchanged, and accepted replay stays at **tick 116**. The next bounded hypothesis will examine a sufficient small-normal-impulse friction branch while retaining the original physical gates. No speedup, candidate promotion or physical application is claimed.


## 2026-09-25 — Sticking and sliding constraints checked separately

The [friction-family diagnostic](../benchmarks/experiments/glass-tick117-best-friction-families-20260925-01/README.md) completed **37 algebraic/mutation controls, eight small solves and two captured solves**, with independent **80/96-digit** physical checks and exact phase-certificate verification. It preserves every retained expression of the original full frozen approximation and explicitly records its relationship to current v5 production.

Removing sticking constraints gave a selected normal residual of **9.8954863e-7 m/s**, but full friction error **3.0332152e-3 m/s**. Removing sliding constraints gave **9.8999998e-7 m/s** normal and **2.3073393e-2 m/s** friction error. Both candidates fail the full law and neither improves the best **1.0730064606260127e-6 m/s** residual. Their exact phase lower bounds strengthen to zero, so neither excludes its relaxed-model target; this is not an exact primal-feasibility proof. The full approximation's prior exclusion remains valid.

Next, certify the near-feasible retained constraints and group original-law errors by friction classification before changing the joint approximation. Current physics source, the accepted tick-116 checkpoint and the best impulse are unchanged. No candidate was applied or promoted; the optimization goal remains active.


## 2026-09-25 — Startup guard and required collision validation

The [startup and validation review](../benchmarks/experiments/review-startup-validation-20260925-01/README.md) closes the remaining startup Reset race and missing required collision coverage. Controls wait for initial worker/renderer setup, Reset rejects loading states, and the shared action handler protects scene operations during loading.

`npm run test:collision` is now required by `npm test`, `npm run validate`, and both CI workflows. All **122 targeted tests passed on Node 20.19.0 and Node 22.22.3**, including contact rollback, canopy transfer/shared workers and glass recovery. An in-memory TypeScript loader preserves the documented Node support range. Final TypeScript and an isolated browser bundle build also passed; the existing large-chunk warning remains.

The live canopy worker reached **29.92 seconds** and Reset returned it to Ready at **0.00 seconds**, with no captured warning or error. That temporary canopy tab used the WebGL 2 fallback; the original bridge preview remains ready with **WebGPU renderer · worker** on port **4401**. Physics source and the unresolved friction-research target are unchanged.


## 2026-09-25 — Unresolved collision steps now roll back

The [atomic recovery change](../benchmarks/experiments/glass-ccd-atomic-recovery-20260925-01/README.md) installs `convex-contact-sat-js-f64-v5`. Exhausted sweep, contact-discovery and endpoint checks now reject the full step. Recovery restores body motion, cached contact impulses and accepted telemetry, plus glass time, fracture state and presentation data. Reusable buffers replace the per-interval snapshot vectors.

All **662 recorded complete states** match the preceding successful release and thick-panel trajectories. **113 targeted tests** pass across a combined run and the separately completed final file; TypeScript and the isolated browser bundle build pass. The live WebGPU glass worker completed **12 seconds**, recorded **three impacts**, reset to Ready and emitted no captured console warning or error. The original bridge studio remains open.

The combined test command timed out after 109 passes; the remaining four tests subsequently passed. Buffer reuse is verified, but the timing probe does not establish a speedup. The prior glass contact-law residual remains above its target; no numerical candidate or physical state was promoted. The startup Reset guard, required CI coverage and friction optimization remain open.


## Normal-cone relaxation at the best reference — September 25, 2026

The [current-reference relaxation](../benchmarks/experiments/glass-tick117-best-normal-relaxation-20260925-01/README.md)
meets the selected and original normal-contact target at **9.899988619367897e-7 m/s**
while preserving the fixed normal branches, impulse cones, energy, momentum and
movement bounds. Only the sticking/sliding residual approximation groups and
unused curvature coordinates were removed from the actual saved matrix. Every
retained expression matches exactly. This updates the older normal-only result,
which used a different reference and allowance.

The full candidate is **rejected**: its friction residual is
**0.0008055429696460607 m/s**. All **23 new controls**, four small conic controls,
and independent 80/96-digit physical checks pass. There was one captured solve,
for **five new solves total**. The exact relaxed phase bound is zero and does not
exclude the target; its bound alone is inconclusive. The earlier full-model
exclusion remains valid.

The best full residual stays **1.0730064606260127e-6 m/s** and replay stays at
**tick 116**. No physical state or production code changed. Next, restore sticking
and fast-sliding restrictions separately at this same best reference to locate
which approximation causes the remaining coupled limit. No engine speedup or
global physical nonexistence is claimed.


## Exact phase bound — September 25, 2026

The [exact phase-bound audit](../benchmarks/experiments/glass-tick117-exact-phase-bound-20260925-01/README.md)
proves that the current frozen contact approximation cannot attain its target
phase. Its stronger exact lower bound is **0.06775750004185153**, versus a target
of **0.009319608377993135**. The corresponding nominal model residual floor is
**1.0627042353001125e-6 m/s**. This excludes the target within this approximation;
it is not a physical nonexistence proof or a measured original-law lower bound.

Both saved unpruned and pruned duals passed exact cone checks without repair.
All **67 new controls** and an independent column-wise rational recomputation
passed, covering 41,908 variables per class of bound terms and 213,590 original
constraint rows across both certificates. There were **zero new optimizer calls**.
The best original-law residual remains **1.0730064606260127e-6 m/s**, above the
1e-6 target. Production code and the accepted replay remain unchanged.

The next experiment will change a supported mode, domain or curvature assumption
in the local approximation, using the same best physical reference. Tightening
tolerances or pruning equivalent rows in the certified model cannot meet its
target phase.


The [best-reference numerical/projection audit](../benchmarks/experiments/glass-tick117-best-reference-stall-audit-20260925-01/README.md) verifies **1,364,900 diagnostic values at 80 digits** with **zero new solves**. All **45 new controls** pass. Both raw solutions remain about **7.23% above the original target** and violate their impulse cones; projection explains only **0.997–1.570%** of the remaining error gap. Projection at contact **5959** moves the limiting error from raw contact **5521** to **5485**. Both stored models fail the full KKT diagnostic, while their raw physical errors closely track their positive model phases. The next zero-solve test will construct an exact finite-domain phase bound for the saved approximation before another optimizer change. The best **1.0730064606260127e-06 m/s**, production, **1e-6** target and accepted **tick 116** remain unchanged; no speedup or physical nonexistence is claimed.

The [best-reference pruning test](../benchmarks/experiments/glass-tick117-best-reference-pruning-20260925-01/README.md) matches the actual saved unpruned model exactly and independently proves **14,546 redundant rows (13.62%)**, reducing **106,795 rows to 92,249**. All **35 new initializer/admission controls**, reused **14 small physical cases, 75 dominance controls and 53 box controls**, and captured **80-digit** readback pass. The first reduced solve returns AlmostSolved but worsens original-law error to **1.073442488846253e-06 m/s**, so it is rejected and the run stops after **one solve**. The best **1.0730064606260127e-06 m/s** remains unchanged. A zero-new-solve audit will compare the saved unpruned and reduced numerical defects and raw-versus-projected physical residuals before another optimizer change. Production, the **1e-6** target and accepted **tick 116** remain unchanged; no speedup is claimed.

The [exact lower-bound dominance experiment](../benchmarks/experiments/glass-tick117-lower-bound-dominance-20260925-01/README.md) proves another **3,840 normal bounds** redundant at the captured start, reducing **99,911 rows to 84,732 (15.19%)** while preserving every existing proof premise. All **75 new proof/control comparisons**, **14 small physical cases** and four captured **80-digit** readbacks pass. Four admitted steps reduce the separate experimental error **1.463%** to **0.00046443264123552163 m/s**, with zero removed-bound violations, raw negative-normal velocity and cap excess. The saved best **1.0730064606260127e-06 m/s** is unchanged. The validated reduction will next be tested directly at that best reference against its saved unpruned follow-up model. Production, the original **1e-6** target and accepted **tick 116** remain unchanged; no speedup is claimed.

The [audit of the new reduced-model stall](../benchmarks/experiments/glass-tick117-pruned-stall-audit-20260925-01/README.md) independently verifies **693,014 diagnostic values** at **80 digits** with **zero new solves**. The failed stage's objective gap **0.00012292429223064053** is dominated by complementarity **0.0001192723970658775**; its phase stationarity defect is **4.150984938481706e-7**. Both compared models fail the complete KKT diagnostic gate. Retained boxes contribute **47.977%** and explicit nonnegative-normal rows **10.152%** of failed stored-slack complementarity. The next exact-reduction test will remove only nonnegative-normal rows proved weaker than retained lower movement bounds, preserving every existing proof premise. Nine source-selection controls pass and nineteen KKT controls are reused by unchanged-source hashes. The saved best **1.0730064606260127e-06 m/s**, production, original **1e-6** target and accepted **tick 116** remain unchanged.

The [pruned-model continuation](../benchmarks/experiments/glass-tick117-pruned-continuation-20260925-01/README.md) stops after its first new solve returns **InsufficientProgress** at original path stage **16**. All **26 input/driver/bound-gate checks** pass, and **14 small physical cases plus 53 proof controls** are reused by hash. The model removes **11,339 exactly proved redundant rows (11.35%)**; independent **80-digit** readback finds zero omitted-bound violation. No physical candidate is admitted. The last experimental state remains **0.00047132791195434441 m/s**, and the saved best remains **1.0730064606260127e-06 m/s**. A zero-new-solve KKT audit will compare the preceding admitted reduced model with this failure before another optimizer change. Production, the **1e-6** target and accepted **tick 116** remain unchanged; no speedup is claimed.

The [exact redundant-bound experiment](../benchmarks/experiments/glass-tick117-redundant-box-20260924-01/README.md) removes **9,771–10,994 rigorously redundant rows (9.73–11.00%)** while preserving each stored model's feasible set and objective. Four reduced solves continue beyond the preceding stall and reduce the separate experimental error **5.019%**, from **0.00049623372654045725 to 0.00047132791195434441 m/s**. All **53 structural/proof/gate comparisons**, **14 small physical cases**, retained-model checks and captured **80-digit** readback pass; removed-bound violations and fixed-cap excess are zero. The result remains **439.26x worse** than the saved best **1.0730064606260127e-06 m/s**. The final step still descends **4.0801%**, supporting a separately bounded continuation with the same proved reduction. No reference is promoted or applied, and no speedup is claimed. Production, the **1e-6** target and accepted **tick 116** remain unchanged.

The [saved-solve numerical audit](../benchmarks/experiments/glass-tick117-stall-audit-20260924-01/README.md) independently verifies **40,529 stationarity columns**, **201,181 constraint rows** and **745,030 diagnostic values** at **80 digits**, with **zero new solves**. Nineteen analytical/mutation/input checks pass. The failed eighth solve's objective gap is dominated by complementarity, with **56.14%** of stored-slack complementarity in **39,774 step-box rows**. Both saved models fail the complete numerical KKT gate; the eighth also fails the approximate dual gate. This motivates testing deletion of individually proved redundant impulse bounds, using exact implications from retained contact cones and normal bounds. No physical constraint may be weakened. The best **1.0730064606260127e-6 m/s** reference, **1e-6** target, production and accepted **tick 116** remain unchanged.

The [capped continuation](../benchmarks/experiments/glass-tick117-cap-continuation-20260924-01/README.md) accepts **seven additional steps**, reducing its experimental error **22.10%**, from **0.0006370056509699828 to 0.0004962337265404572 m/s**. The eighth solve returns **InsufficientProgress** and is rejected. None improves the saved best **1.0730064606260127e-6 m/s**. All **22 new driver/input checks** and independent 80-digit history reconstruction pass; 14 small physical controls are reused by hash with no reruns. The contact cap has zero excess throughout the seven admitted stages. The failed model's recorded dual stationarity and objective gap motivate a **zero-new-solve numerical audit** before another continuation. No reference is promoted or applied. Production, runtime qualification, the **1e-6** target and accepted **tick 116** remain unchanged.

The [fixed impulse-cap experiment](../benchmarks/experiments/glass-tick117-impulse-cap-20260924-01/README.md) keeps contact **5511** below its original normal impulse with **zero measured cap excess**, but the final original-law error **0.0006370056509699828 m/s** is effectively the same as the uncapped trial. The **1.0730064606260127e-6 m/s** best reference is preserved. All **14 small systems**, 28 disabled-model comparisons, four cap-model checks, **15 coordinate comparisons / 120 vectors**, cap/momentum guards and independent 80-digit readback pass. The four captured steps stop at their declared limit, with the last still descending by **12.542%**; a separately bounded continuation will retain this worse path only as an experimental start. The capture has one connected component of all **303 dynamic bodies**, so disconnected-island splitting adds no decomposition here. No candidate is promoted or applied. Production, runtime qualification, the **1e-6** target and accepted **tick 116** remain unchanged.

The [paired-release experiment](../benchmarks/experiments/glass-tick117-paired-release-20260924-01/README.md) tests forced contacts **5511 and 5963** through four independently checked descending steps, but finishes at **0.00063700536733246192 m/s**, about **593.66x worse** than the saved best **1.0730064606260127e-06 m/s**. All **14 small systems** match their expected outcomes; 160 high-precision transform controls, **15 coordinate comparisons / 120 mapped vectors**, 31 mutation/index guards and independent 80-digit captured readback pass. The shared phase allowance lets the already released contact **5511** regain up to **1593.47x** its starting normal impulse. The next controlled model test will cap that existing impulse independently while attempting the new release, starting again from the best reference. No candidate is promoted or applied. Production, runtime qualification, the **1e-6** target and accepted **tick 116** remain unchanged.

The [audit of the improved reference](../benchmarks/experiments/glass-tick117-post-release-audit-20260924-01/README.md) checks all **6,023 original contact laws** and refreshes release ranking with **zero new solves**. Normal constraints carry **84.71%** of the saved step's local phase sensitivity, versus **15.26%** for sticking bounds; the movement box uses only **6.06%** of its radius. Independent 80-digit checks cover **20,957 stationarity columns** and **1,069 curvature duals**. Contact **5963** has the smallest measured disturbance among five leading eligible contacts and becomes the next gradual-release hypothesis, retaining the existing branch at **5511**. All six direct removals fail the physical target. Seven valid small anchors, thirteen release controls, eight selection/input checks and full saved-vector reconstruction pass. The best residual **1.0730064606260127e-06 m/s**, the **1e-6** gate, production and accepted **tick 116** remain unchanged.

The [sticking-contact release experiment](../benchmarks/experiments/glass-tick117-sticking-release-20260924-01/README.md) independently improves the saved original-law residual from **1.1304124928176007e-06 to 1.0730064606260127e-06 m/s** (**5.08%**). Contact **5511** unloads through two accepted experimental stages; a slightly worse third stage is rejected and the run stops. All **12 small controls** match their expected outcomes, including two new supported sticking-release cases and two analytical rejections. **160** high-precision transform controls, **13 coordinate comparisons / 104 mapped vectors**, 27 mutation/selection guards and 80-digit saved-vector readback pass. Stage 2 becomes the new offline reference, but remains **7.30% above** the unchanged **1e-6** physical target. No physical state is applied; production, runtime qualification and accepted **tick 116** remain unchanged. Audit the new reference's active constraints and release candidates before another solve.

The [release-disturbance ranking](../benchmarks/experiments/glass-tick117-release-ranking-20260924-01/README.md) independently checks **seven leading separating contacts** from the saved best with **zero new optimization solves**. Contact **5511**, a sticking contact, produces the smallest direct-release error (**0.0014732562118077632 m/s**) and contact-velocity change (**0.0014743866242882943 m/s**) among the selected candidates. Contact 5959 causes about **9.41x** greater full error and **19.03x** greater velocity disturbance; these are not speedup figures. All seven releases still fail the **1e-6** physical target. Five valid small anchors, nine release controls (including two energy-increase rejections), seven policy/input controls and 80-digit captured reconstruction pass. The next bounded trial will use the verified gradual-release normalization at contact 5511 from the preserved best. Best residual **1.1304124928176007e-06 m/s**, production and accepted **tick 116** remain unchanged.

The [equivalent branch-scaling experiment](../benchmarks/experiments/glass-tick117-branch-scaling-20260924-01/README.md) replaces the preceding immediate solver stall with **four independently checked branch-descending steps**, without changing physical constraints or tolerances. **160 high-precision transform controls**, ten exact disabled-model comparisons, **11 coordinate comparisons / 88 mapped vectors**, 23 mutation/selection guards and ten small physical solves pass. The captured witness phase falls from **11990.48 to 0.999927** under an equivalent coordinate map. Its final original-law error is **0.0020445075991790615 m/s**, still much worse than the saved best **1.1304124928176007e-06 m/s**; branch progress is not physical improvement. No candidate is promoted or applied. Production, runtime qualification and accepted **tick 116** remain unchanged. Return to the best state and measure alternative branch-release disturbances before another solve.

The [gradual-release experiment](../benchmarks/experiments/glass-tick117-gradual-release-20260924-01/README.md) starts at the saved best and changes only contact **5959** to its normal impulse upper bound, allowing release without zeroing its starting impulse. Ten exact model comparisons, ten momentum mutation guards, three invalid-selection guards and all ten small physical controls pass independent checks. The captured model preserves **106,919** expression rows and has a valid starting witness, but its one large solve returns **InsufficientProgress** after **36 iterations**; no candidate or continuation is admitted. Its branch merit is about **0.0135552 m/s** while its coordinate scale remains **1.1304e-6 m/s**, motivating a new equivalence-checked normalization test. This is a numerical hypothesis, not physical infeasibility. Best original residual **1.1304124928176007e-06 m/s**, production and accepted **tick 116** remain unchanged.

The [contact-reactivation experiment](../benchmarks/experiments/glass-tick117-contact-reactivation-20260924-02/README.md) restores the ordinary normal/friction law at contact **5959** and completes four independently checked descending steps, reducing its trial from **0.00033396848979749014 to 0.00029939130028271491 m/s** (**10.35%**). Ten small controls, ten mechanical comparisons, five mutation guards and captured 80-digit readback pass. A reporting-only serialization failure is preserved in the preceding packet, which ran zero solves. The reactivated trial remains worse than the saved best **1.1304124928176007e-06 m/s**, so no reference is replaced or applied. The **1e-6** physical target remains unmet; production, runtime qualification and accepted replay at **tick 116** remain unchanged. Return to the saved best before choosing the next bounded contact-mode investigation.

The [resumed contact-release comparison](../benchmarks/experiments/glass-tick117-release-resume-20260919-01/README.md) completes four independently checked steps with the current friction bounds, reducing the release trial from **0.000520505625061299 to 0.00033396848979749014 m/s**. The matched old model returns `NumericalError`; its vector is rejected. All **18 small controls**, nine model comparisons and captured 80-digit readback pass. Contact 5959 remains at zero impulse while closing at the maximum normal defect; the next experiment restores its ordinary contact law from this trial. This trial is still worse than the saved best **1.1304124928176007e-6 m/s**. No reference is replaced or applied; production and accepted replay at **tick 116** remain unchanged.

The [friction-family certificates](../benchmarks/experiments/glass-tick117-family-certificates-20260919-01/README.md) independently prove modeled residual floors of **1.0974343752624891e-6 m/s** without sticking bounds and **1.0684884768102763e-6 m/s** without fast-sliding bounds at allowance 256. Directed **80- and 96-digit** arithmetic accounts for all stationarity error, including 1,080 curvature coordinates, with a **1e-8 raw-model violation allowance**. These are limits of the fixed convex models, not global physical nonexistence. No new optimization solves run. The next branch investigation resumes the previously checked contact-5959 release trial using the improved friction bounds. Best full residual **1.1304124928176007e-6 m/s**, the **1e-6** physical gate, production and accepted replay at **tick 116** remain unchanged.

The [complementary friction comparison](../benchmarks/experiments/glass-tick117-friction-families-20260919-01/README.md) at allowance **256** gives independent normal residuals of **1.0978625884302014e-6 m/s** without sticking bounds and **1.0685860323081364e-6 m/s** without fast-sliding bounds. Both miss the **1e-6** target and violate the original friction law. Twenty exact model checks, ten mutation guards, ten small solves and two captured solves pass independent readback. Saved dual vectors will distinguish a fixed-model restriction from numerical failure. The best full residual remains **1.1304124928176007e-6 m/s**; neither diagnostic is promoted or applied. Production, performance qualification and accepted replay at **tick 116** remain unchanged.

The [larger-movement experiment](../benchmarks/experiments/glass-tick117-larger-movement-20260919-02/README.md) verifies the normal-only necessary conditions at allowance **256**, but restoring full friction produces **1.1308456752419874e-6 m/s**, slightly worse than the preserved best **1.1304124928176007e-6 m/s**. Allowance 128 fails the normal gate and its full solve is skipped. An equivalent active-energy cone scaling passes 39 independent identities; 20 model comparisons and 20 small solves preserve the original acceptance thresholds, including rejection of impossible-energy controls. All 23 solves and independent 80-digit readback complete. The next comparison isolates sticking and fast-sliding restrictions at allowance 256. No candidate is promoted or applied; the **1e-6** physical target remains unmet, with production and accepted replay at **tick 116** unchanged.

The [bounded normal-model certificate](../benchmarks/experiments/glass-tick117-normal-dual-bound-20260919-01/README.md) independently proves at **80 and 96 digits** that the saved normal-only relaxation cannot reach the **1e-6 m/s** target within its fixed normal branches and current movement box, even allowing **1e-8 raw model block violation**. The certified equivalent normal-limit floor is at least **1.06959648e-6 m/s**; stationarity and domain penalties are fully included. A box-neutral certificate implies a necessary configured correction radius above **103.21044**, versus **32** now, supporting bounded comparisons at 128 and 256. Eight analytical controls, three invalid-dual guards and a repair check pass; no new solves run. This is a finite frozen-model result, not global physical infeasibility. Best original-law residual **1.1304124928176007e-6 m/s**, production and accepted **tick 116** remain unchanged.

The [friction-relaxation comparison](../benchmarks/experiments/glass-tick117-friction-relaxation-20260919-01/README.md) preserves every necessary normal, momentum, energy and impulse-cone condition while removing sufficient friction envelopes. Fifteen small model checks and fifteen small solves pass independent 80-digit readback; seven relaxed positive cases illustrate that normal feasibility can still fail friction. In the captured case, removing all friction envelopes gives **1.09405922e-6 m/s normal error and 4.45181356e-4 m/s full error**, so it does not qualify. The intermediate relaxation returns `NumericalError` and produces no candidate. No result improves the **1.1304124928176007e-6 m/s** best. A bounded dual certificate is next; the positive model phase alone is not infeasibility proof. Eighteen solves complete; production and accepted **tick 116** remain unchanged.

The [balanced-step constraint audit](../benchmarks/experiments/glass-tick117-balanced-bound-audit-20260918-01/README.md) checks all **20,968 stationarity columns and 1,080 curvature duals at 80 digits**, with zero new solves. Selected normal constraints account for **96.7667%** of local phase sensitivity, versus **3.19515%** from sticking bounds and **0.03811%** from sliding bounds. Impulse movement uses 99.2124% of its box, but its dual weight is only 7.60e-9; sliding trust utilization peaks at 27.943%. This supports a controlled normal/friction relaxation comparison instead of simply expanding the movement allowance. These are approximate local sensitivities, not physical nonexistence proof. Best residual **1.1304124928176007e-6 m/s**, production and accepted **tick 116** remain unchanged.

The [balanced-curvature readback](../benchmarks/experiments/glass-tick117-curvature-readback-20260918-01/README.md) independently verifies **four saved candidates at 80 digits**, running no new solves. Two equivalent balances, **1/64 and 1/16**, pass 150 transform controls, ten model checks and the same five physical systems at both settings. Both captured comparisons and two continuation steps pass the unchanged contact momentum gate, improving the best residual to **1.1304124928176007e-6 m/s**. The original **1e-6 target is still unmet**. The original wrapper stopped on an empty memory receipt after producing its results; its missing exit code and peak RSS remain unknown and that packet stays incomplete. This separate readback and review complete with corrected atomic receipt shutdown. No runtime gain, physical application or replay advance is claimed; production and accepted **tick 116** remain unchanged. Next: identify which model bounds limit further balanced descent.

The [slow-sliding-bound experiment](../benchmarks/experiments/glass-tick117-slow-slip-bound-20260918-01/README.md) replaces **85 local sliding approximations**, deleting **85 auxiliaries and 765 rows** while preserving unrelated equations exactly. Five new model checks and four physical controls pass, with an impossible-energy case rejected at 80 digits; the prior 810 scalar controls are reused by hash. Sparse entries fall **0.985%**, but factor entries rise **0.219%**, so no memory or runtime gain is claimed. Two valid descending steps improve the independent maximum to **1.1304685504592103e-6 m/s**. The third returns `AlmostSolved` but fails the unchanged **1e-9 m/s momentum consistency** gate and is rejected. Saved diagnostics locate the largest slack drift in retained sliding-curvature cones; an equivalent balanced cone representation is next. The **1e-6 target remains unmet**; production, physical application and accepted replay at **tick 116** remain unchanged.

The [sticking-constraint experiment](../benchmarks/experiments/glass-tick117-sticking-bound-20260918-01/README.md) safely removes **4,743 redundant cones**, with exact equality of every retained equation and coefficient. **810 scalar controls at 80 digits**, four model comparisons, three positive physical controls and one impossible-energy rejection pass. The matched 6,023-contact model has **15.54% fewer sparse entries and 16.10% fewer factor entries**, but measured time is **9.979 s strict versus 10.074 s relaxed** in one comparison, so no speedup is claimed. Two relaxed steps improve the independent maximum to **1.1307787320307032e-6 m/s**; a third returns `NumericalError` and is rejected. The **1e-6 target remains unmet**. Next: inspect slack drift and test the same global velocity bound on eligible slow sliding contacts. No state is applied; production and accepted replay at **tick 116** remain unchanged.

The [equivalent coordinate-scaling experiment](../benchmarks/experiments/glass-tick117-motion-scaling-20260918-01/README.md) passes **32 equivalence checks across four states** and preserves physical tolerances, movement limits and objective ordering. It resumes only from the last independently verified trial and completes four descending `AlmostSolved` steps, reducing that trial from **0.00354280 to 0.000520506 m/s** with independent 80-digit cone/energy/momentum checks. This remains worse than the saved best. The next comparison will return to that best state and test removal of an unnecessary sticking-domain cone under the projection nonexpansivity bound. Best verified residual **1.1310427302886386e-6 m/s**, production and accepted replay at **tick 116** remain unchanged.

The [coupled release-motion experiment](../benchmarks/experiments/glass-tick117-release-motion-20260918-01/README.md) holds contact **5959** at zero impulse and permits body motion. Two small physical controls pass independent 80-digit checks; an unsupported release remains rejected. The first captured step reduces the release trial residual from **0.0138562 to 0.00354280 m/s** with valid cone/energy/momentum checks. The second step returns `NumericalError` and is not used as a candidate. This trial is worse than the saved best. The next experiment will test equivalent coordinate normalization at the current residual scale. Best verified residual **1.1310427302886386e-6 m/s**, production and accepted replay at **tick 116** remain unchanged.

The [bounded release certificate](../benchmarks/experiments/glass-tick117-release-dual-bound-20260918-01/README.md) independently verifies, with directed **80- and 96-digit arithmetic**, that captured contact **5959** cannot release at fixed body velocity within a maximum weighted impulse displacement of **10,000**, even allowing **1e-8** raw model block violation. Its verified contradiction bound is **-0.80413868538**; a feasible redistribution would require displacement above **51,263.15** in those weighted coordinates. Eight analytical controls and three invalid-dual guards pass. This is a bounded frozen-model result, not global physical infeasibility. The next experiment will allow coupled body motion during release. Best collision residual **1.1310427302886386e-6 m/s**, production and accepted replay at **tick 116** remain unchanged.

The [necessary-cone release experiment](../benchmarks/experiments/glass-tick117-release-outer-cone-20260918-01/README.md) removes all sufficient friction envelopes, local trust domains and radius floors, but contact **5959** still returns `PrimalInfeasible` at fixed body velocity. Analytical load-transfer and unique-support controls pass independent 80-digit checks. The next step will verify a bounded dual certificate from the retained matrix and dual vector rather than rely on solver status. No physical candidate is produced. Best verified residual **1.1310427302886386e-6 m/s**, production and accepted replay at **tick 116** remain unchanged.

The [fixed-momentum release experiment](../benchmarks/experiments/glass-tick117-contact-release-20260918-01/README.md) passes two independent 80-digit load-transfer controls and correctly rejects an impossible unique-support release. Releasing captured contact **5959** with sufficient friction bounds returns `PrimalInfeasible`; its vector is not a physical candidate, and the gated coupled solve is skipped. The next diagnostic will remove the sufficient friction envelopes while retaining necessary momentum and impulse-cone constraints to identify which restrictions prevent release. Best verified residual **1.1310427302886386e-6 m/s**, production and accepted replay at **tick 116** remain unchanged.

The [centered-energy coupled experiment](../benchmarks/experiments/glass-tick117-coupled-energy-20260918-02/README.md) produces an independently checked reference candidate with residual **1.1310427302886386e-6 m/s**, a small improvement from **1.1320442559065028e-6 m/s**. Seven positive small collision cases, an analytically impossible rebound, 136 mathematical controls and energy algebra checks pass independent validation. The captured 6,023-contact solve retains all 1,818 momentum equations and returns `AlmostSolved`; its unscaled cone deficit is 2.06e-12, and the candidate has zero cone violation and negative contact energy change. **The 1e-6 m/s physical target is still unmet.** A local sensitivity diagnostic points to contact release and fixed normal branches for the next investigation. No state is applied: production, runtime qualification and accepted replay at **tick 116** remain unchanged.

The [coupled-scaling experiment](../benchmarks/experiments/glass-tick117-coupled-scaling-20260918-01/README.md) stops at its small-case gate: six solves pass the primary physical check, including the large-impulse control, but the large separating-velocity case returns `InsufficientProgress`. The captured solve and small-case physical oracle do not run. A new packet will center the kinetic-energy inequality to avoid subtracting nearly equal large quantities. This incomplete experiment qualifies no physical change; best residual **1.1320442559065028e-6 m/s**, production and accepted replay at **tick 116** remain unchanged.

The [coupled-contact experiment](../benchmarks/experiments/glass-tick117-coupled-contact-20260918-01/README.md) passes **136 variable-velocity controls** and **five positive small collision cases at 80 digits**; an analytically impossible rebound remains rejected. The captured model retains **all 1,818 momentum equations** and has a feasible starting witness, but its one 6,023-contact solve returns `InsufficientProgress` after 40 iterations. No physical candidate is accepted. Large differences in constraint scales will be addressed in a new packet. Best full residual **1.1320442559065028e-6 m/s**, production, performance qualification and accepted replay at **tick 116** remain unchanged.

The [sliding-majorant experiment](../benchmarks/experiments/glass-tick117-sliding-majorant-20260918-01/README.md) supplies independently verified contact-level starting witnesses for **all 6,023 contacts** in each retained anchor, using its local branch for only **24** contacts. It also covers every contact already within the physical tolerance. The model retains the sliding derivative and adds a proved curvature remainder; **138 controls**, two certified descent examples, and **30,115 contact comparisons at 80 digits** pass. The next model will couple impulse and body-velocity changes using exact sticking constraints and the sliding remainder. The physical target is still unmet: best full residual **1.1320442559065028e-6 m/s**, production and accepted replay at **tick 116** remain unchanged. No full-island solve, application or runtime qualification ran in this packet.

The [quadratic radial-reference experiment](../benchmarks/experiments/glass-tick117-quadratic-reference-20260917-01/README.md) passes **146 controls and 30,115 contact comparisons at 80 digits**. Combined reference constraints now cover **3,877 of 3,878** physically admissible contacts on the preserved best; only contact **4620** remains excluded. At the unchanged starting ceiling, **24 of 6,023** contacts remain excluded, down from 36. Contact **5538** now fits that starting ceiling. The next model will retain the local sliding derivative and bound its curvature, so it can certify improvement below the anchor. No new full-island solve or physical application ran. Best full residual **1.1320442559065028e-6 m/s**, production, performance qualification and accepted replay at **tick 116** remain unchanged.

The [fixed-direction boundary-reference experiment](../benchmarks/experiments/glass-tick117-boundary-reference-20260917-01/README.md) adds **30,115 independently checked contact comparisons**. Combining its bound with the earlier bounds reduces excluded physically admissible contacts on the preserved best from the original **656 to 11**. Fixed choices still exclude **36 of 6,023** contacts at the unchanged starting ceiling, including contact **5538**, so no all-contact model witness or new solver result is claimed. Fixed anchor choices also lose coverage after redistribution. The next bound will combine radial and transverse errors quadratically. Best full residual **1.1320442559065028e-6 m/s**, production, performance qualification and accepted replay at **tick 116** remain unchanged.

The [elliptic friction-bound experiment](../benchmarks/experiments/glass-tick117-radius-bound-20260917-01/README.md) passes **60,230 comparisons at 80-digit precision**. On the preserved best state, its half-radius version recovers **602** contacts that pass the physical contact law but fail the previous bound, while losing none previously covered; **54** remain excluded. It covers all four dominant half contacts. A radius floor reduces coverage after redistribution, and oblique contact **5538** remains excluded at its starting ceiling. The next model will test a direction fixed to each anchor impulse. This is improved reference-model coverage; best full residual **1.1320442559065028e-6 m/s**, production, performance qualification and accepted replay at **tick 116** remain unchanged.

The [exact-friction geometry experiment](../benchmarks/experiments/glass-tick117-friction-sublevel-20260917-01/README.md) verifies that two valid impulses can have an invalid midpoint: the analytic endpoints produce **5.0e-7 m/s**, while their midpoint produces **2.0e-6 m/s**. A new exact slip-coordinate formula passes 137 controls and agrees with all **30,115 retained contacts**. Contact **5538** shows this behavior at its starting ceiling; the dominant half contacts keep valid midpoints, so their local bound still needs tightening. This guides a limited local approximation, not a new physical result. Production, best full residual and accepted replay at **tick 116** remain unchanged.

The [contact-bound audit](../benchmarks/experiments/glass-tick117-gap-limits-20260917-02/README.md) checks **30,115 retained contact states at 80-digit precision**. In the preserved best state, **656 contacts** pass the original physical contact-law checks but fail the conservative friction bound; the classifications agree exactly with the binary64 analysis. The half phase is dominated by body pairs **292–294** and **294–351**. The body phase's remaining conic defect is a momentum equation, and uniform scaled slack gives strongly uneven physical-error allowances. These results identify the model geometry to refine; they do not qualify a new collision solution. Best residual, production and accepted replay at **tick 116** remain unchanged.

The [reconstructed-primal collision diagnostic](../benchmarks/experiments/glass-tick117-gap-primal-certificate-20260917-01/README.md) verifies two reference-solver fixes: infeasible outputs receive **zero impulse trials**, and primal feasibility is checked directly from the returned point. Three analytic cases, ten oracle mutations and baseline comparisons pass. Both large glass phases complete; only the half phase passes its independent numerical certificate, and **neither** passes the original friction/seed gates. Best collision residual remains **1.1320443e-6 m/s** against **1e-6**. Production, accepted replay at **tick 116** and runtime qualification remain unchanged.

The [fixed-velocity friction-gap experiment](../benchmarks/experiments/glass-tick117-friction-gap-20260917-01/README.md) passes **518 bound checks at 80-digit precision**, 64 rotations, two analytic QPs and twelve preserved roots. The large half case remains numerically inaccurate; the body case reports the conservative model infeasible. Neither yields a new seed, so both minimax stages perform **zero solves**. A counterexample confirms that this sufficient bound can reject an exact-law-acceptable point. The subsequent reconstructed-primal phase diagnostic above completes both large cases; neither yields a new numerical seed. Best physical residual, production and accepted replay at **tick 116** remain unchanged.

The [independent-momentum QP comparison](../benchmarks/experiments/glass-tick117-independent-momentum-20260917-01/README.md) verifies removal of one dependent equality while retaining every original momentum check. Sixty equation reconstructions, incompatible-RHS controls and **24 preserved roots** pass. The reduced half case uses **two QPs instead of four**; the body case is essentially unchanged. All four numerical seeds pass, but every full minimax handoff accepts **zero steps**, and none beats the preserved **1.1320443e-6 m/s** best. The subsequent sufficient-friction-bound experiment above preserves the original physical gate but yields no new seed. Physical gates, production and accepted replay at **tick 116** remain unchanged.

The [rank-aware momentum experiment](../benchmarks/experiments/glass-tick117-rank-aware-restoration-20260917-01/README.md) directly verifies one numerical null direction and qualifies **all eight linear corrections** using nine range-inverse applications. Independent contact drift falls below **6.42e-14 m/s**, but the corrections violate normal/friction cones; projecting back reintroduces **5.05e-7–1.94e-6 m/s** drift and the full friction law still fails. No new numerical seed or physical application qualifies. The subsequent matched constrained-solver test above preserves the equations but yields no new physical result. Best original residual, production and accepted replay at **tick 116** remain unchanged.

The [momentum-restoration audit](../benchmarks/experiments/glass-tick117-momentum-restoration-20260917-01/README.md) finds **1,817 of 1,818** resolved modes in the weighted body matrix. Its conditioning guard rejects all eight attempts before factorization, so **zero large correction solves** run. Independent readback confirms that radial cone projection increases the saved proposals' momentum drift. Twelve dense minimum-norm controls and rank/conditioning rejection tests pass. The subsequent rank-aware correction above passes its linear checks but still fails the complete contact constraints. Best original residual, physical gate, production and accepted replay at **tick 116** remain unchanged.

The [centered-redistribution comparison](../benchmarks/experiments/glass-tick117-centered-redistribution-20260917-01/README.md) verifies **four admissible numerical starts** using four extra halved trial steps. Fresh affine, rotation, exact-baseline and rejection controls pass, along with **24 preserved manufactured roots**. Pressure reductions remain below **0.5%** because cumulative velocity drift reaches the unchanged diagnostic budget. Each full minimax handoff runs two conic solves and accepts **zero correction steps**. The best independent maximum changes negligibly to **1.1320443e-6 m/s**, still **13.2% above** the unchanged physical gate. The subsequent retained-proposal momentum/cone audit above rejects the direct-factor approach; production and accepted replay at **tick 116** remain unchanged.

The [fixed-velocity impulse-redistribution experiment](../benchmarks/experiments/glass-tick117-impulse-redistribution-20260917-01/README.md) passes its small analytic, rotation and rejection controls, but neither large proposal preserves velocity within the declared budgets. Both return the unchanged start after **12 line trials**; the conditional minimax stages correctly perform **zero solves**. The half case narrowly misses the **1e-10 m/s** contact-drift limit at its final trial. The subsequent matched centered-coordinate and smaller-step comparison above verifies four numerical starts. The best verified **1.13205e-6 m/s**, physical gate **1e-6**, production and accepted replay at **tick 116** remain unchanged.

The [frozen sliding-mobility audit](../benchmarks/experiments/glass-tick117-sliding-mobility-20260917-01/README.md) finds positive single-contact normal response across all **6,023 contacts**, even in the worst tangential friction direction: the minimum ratio is **0.36611**. The three qualifying fast sliders from the limiting-contact group have positive pair minors and full-rank selected matrices at all six saved states. Fresh analytic, dense, rotation and guard controls pass; independent mass reconstructions agree to about **1.3e-15** relative error. These local checks leave the wider sticking-contact coupling unresolved. The subsequent fixed-velocity impulse-redistribution test above rejects both large proposals; the **1e-6** physical gate, production and accepted replay at **tick 116** remain unchanged.

The [minimax-after-Newton comparison](../benchmarks/experiments/glass-tick117-alternating-correction-20260917-01/README.md) verifies substantial mode changes at both projected starts, then lowers their roughly **5.1e-6** maxima to **1.14001e-6 / 1.14144e-6 m/s**. Both take eight accepted steps and reach the 90-second budget. Neither beats the preserved **1.13205e-6** best or passes **1e-6**. The subsequent normal/sliding-friction audit above examines this coupling; similar local model slacks do not prove physical nonexistence. Production, accepted replay at **tick 116** and runtime qualification remain unchanged.

The [release-proposal Newton handoff](../benchmarks/experiments/glass-tick117-release-handoff-20260917-01/README.md) finishes eight further bounded cases. Seven improve their release starts, but the best reaches only **2.08842e-4 m/s**, far above the preserved **1.13205e-6** best and the unchanged **1e-6** gate. All stop at 32 factors with accurate regularized linear solves. Existing small controls are reused by hash, not counted as new tests. The subsequent minimax-after-Newton study above tests these projected near-root iterates. Production, accepted replay at **tick 116** and runtime qualification remain unchanged.

The [equivalent-normal body-space experiment](../benchmarks/experiments/glass-tick117-body-fischer-20260917-01/README.md) passes 31 high-precision scalar checks, 24 cold small physical solves, 24 exact baseline comparisons and 24 preserved roots. All four large runs solve their regularized equations accurately but leave the best original maximum unchanged at **1.13205e-6 m/s**. Reduced aggregate merit is insufficient for the unchanged **1e-6** gate. The subsequent release-proposal handoff above tests these different numerical starts. No physical application, production change, replay advance or runtime qualification.

The [bounded contact-release screen](../benchmarks/experiments/glass-tick117-release-modes-20260917-01/README.md) completes all eight hypotheses and its small physical controls. No hypothesis improves the saved **1.13205e-6 m/s** maximum or passes the unchanged **1e-6** gate. Each reaches its 90-second numerical budget; forced releases initially move far from the near-root state, so these runs establish neither a useful local correction nor physical nonexistence. The subsequent equivalent-normal body-space experiment above tests this combination. Production, runtime qualification and accepted replay at **tick 116** remain unchanged.

The [contact-mode dual audit](../benchmarks/experiments/glass-tick117-mode-dual-audit-20260917-01/README.md) localizes **99.10% / 98.98%** of the local model's limiting weight to sixteen contacts at the two saved starts. Body pairs 317–318, 261–262, 318–319 and 262–319 dominate both rankings; normal-upper contacts **5959 and 5963** are stable leaders. These are approximate dual diagnostics: both large optima miss the declared dual-stationarity check. The subsequent bounded release screen above preserves unilateral constraints and every original contact in the final certificate. Best verified maximum remains **1.13205e-6 m/s** against **1e-6**; production and accepted replay at **tick 116** remain unchanged.

The [nonlinear polishing handoff](../benchmarks/experiments/glass-tick117-cone-newton-polish-20260917-01/README.md) tests both retained conic starts with the unchanged projected and raw/descent Newton correctors. All four reduce aggregate numerical merit but leave the best original-law maximum unchanged at **1.13205e-6 m/s**. Linear solves remain accurate; extra nonlinear iterations do not qualify these starts. The subsequent diagnostic above maps the limiting conic constraints back to contact modes and body pairs. The original **1e-6 m/s** gate, production and accepted replay at **tick 116** remain unchanged.

The [matched coordinate-formulation comparison](../benchmarks/experiments/glass-tick117-centered-cone-20260917-01/README.md) reaches a new independently checked maximum of **1.13205e-6 m/s** with the existing absolute formulation, a further **7.38%** reduction. Centering the nearest-step variables passes twelve equivalence and twelve exact baseline controls but does not improve either large endpoint. All four cases still fail the unchanged **1e-6 m/s** physical gate. The subsequent handoff above tests the already validated nonlinear correctors from the two better retained states. Production, runtime qualification and accepted replay at **tick 116** remain unchanged.

The [attainable-target conic continuation](../benchmarks/experiments/glass-tick117-adaptive-cone-20260917-01/README.md) lowers the best independently checked contact maximum to **1.22227e-6 m/s**, a **64.27%** reduction from the prior body-Newton best and a further **6.38%** reduction from the preceding conic result. Twelve cold physical systems pass; their conic iteration count falls 41.05%. Both large continuations make seven accepted numerical steps before reaching the 90-second budget. The original **1e-6 m/s** gate still fails, and error is redistributed over contacts. Actual application, full replay and runtime performance remain unqualified; accepted replay stays **tick 116**. The subsequent comparison above tests centered nearest-step variables while preserving the mathematical problem.

The [complete-residual conic linearization](../benchmarks/experiments/glass-tick117-cone-linearization-20260917-01/README.md) lowers the best independently checked contact maximum from **3.42106e-6 to 1.30558e-6 m/s (61.84%)**. Twelve cold physical cases, twelve preserved roots, twelve model equivalences and four derivative checks pass. The large outputs still fail the unchanged **1e-6 m/s** gate; error is spread over more contacts, so this is a lower maximum rather than complete convergence. Repeated tighter model targets become numerically unreliable. The subsequent adaptive experiment above computes an attainable model target first. No physical application, production change or performance qualification; accepted replay remains **tick 116**.

The [fixed-mode phase-I diagnostic](../benchmarks/experiments/glass-tick117-mode-phase-20260917-01/README.md) resolves both large slackened problems, with numerically checked minimum velocity slacks of **9.50517e-7 / 7.89850e-7 m/s**. These exceed the diagnostic mode budget; the candidates also fail the full sliding-friction law. Twelve manufactured mode checks pass, but only nine resulting candidates pass the full law. The subsequent complete-residual model above allows modes to change and improves the retained maximum. These phase-I candidates themselves do not qualify.

The [fixed-contact-mode cone reference](../benchmarks/experiments/glass-tick117-mode-cone-20260917-01/README.md) passes twelve small mode tests and correctly distinguishes an invalid fixed mode from a valid separating physical solution. Both large modes exhaust 100 conic iterations without an accepted candidate; this is not an infeasibility proof. The subsequent phase-I diagnostic above minimizes an explicit maximum velocity slack while retaining admissible impulses and exact momentum balance. Physical acceptance remains unchanged at **1e-6 m/s**.

The [impulse-reachability audit](../benchmarks/experiments/glass-tick117-reachability-20260917-01/README.md) shows why unrestricted linear corrections cannot be used as contact forces: the nearly stopped all-direction result has **3,300 negative normal impulses** and **5,074 friction-cone violations**. Resting-contact inverses are strongly sensitive to numerical rank cutoff and also violate admissibility. No physical candidate qualifies. The subsequent constrained mode reference also reaches its numerical bound; a compatible velocity target alone remains insufficient.

The [necessary velocity-compatibility audit](../benchmarks/experiments/glass-tick117-branch-compatibility-20260917-01/README.md) finds exact zero targets for all selected pure-velocity rows at three retained starts (14,822 / 14,652 / 14,641 rows). Zero body velocity satisfies those equations exactly, so no large numerical fit is needed. This does **not** establish reachable body motion or admissible contact impulses; the subsequent reachability audit confirms that admissible impulses still need to be enforced. The best retained failed vector is now independently counted as **67 contacts above tolerance**, with its maximum still **3.42106e-6 m/s** and friction maximum **2.01864e-6 m/s**.

The [verified descent fallback](../benchmarks/experiments/glass-tick117-descent-fallback-20260917-01/README.md) replaces uphill numerical corrections with checked negative-gradient steps, using the same work limits. It clears the earlier line-search stalls: all 29 / 24 fallback steps descend and accept their first trial. It still fails to improve the best projected physical maximum. The necessary body-velocity target audit is complete; unrestricted mobility has been audited, with admissible impulses still unresolved. The best retained result remains **3.42106e-6 m/s**, above the unchanged **1e-6 m/s** gate.

The [matched trial-policy comparison](../benchmarks/experiments/glass-tick117-trial-policy-20260917-01/README.md) shows that allowing unprojected numerical trials does not qualify the retained glass case or beat the prior **3.42106e-6 m/s** maximum. Both raw runs end with a **positive computed merit slope** despite accurate regularized linear solves. A verified descent fallback has now tested that specific condition within the same work limits. Exact default/projected/disabled controls and twelve small physical cases pass; all output candidates remain projected and independently checked.

The [body-space Newton reference](../benchmarks/experiments/glass-tick117-body-newton-20260917-01/README.md) lowers the retained glass maximum from **3.95564e-6 to 3.42106e-6 m/s** (13.51%) using a bounded correction through 1,818 body coordinates. Seventeen derivative/equivalence/guard controls and twelve manufactured physical systems pass. The new result still fails the unchanged **1e-6 m/s** physical gate; its friction maximum rises to **2.01864e-6 m/s**. No proposal is applied or promoted.

The regularized linear equations are solved accurately (largest relative residual 6.45e-11), but both large cases stop at the projected nonlinear line search. Numerical regularization changes only the proposed step, not the physical law. The trial/projection comparison and descent fallback are now complete; the necessary velocity-target audit is complete, with impulse reachability next. Observed reference solve times exclude all prior saved-seed work; this is not runtime integration or a demonstrated frame-rate improvement. Accepted replay remains **tick 116**.

The [independent Newton equation audit](../benchmarks/experiments/glass-tick117-linear-audit-20260917-02/README.md) matches the engine's geometry, contact derivatives, preconditioner and transpose at two retained tick-117 starts, after twelve small dense and three least-squares controls. Both large cases have zero preconditioner fallbacks. Native and independent GMRES leave the same 29.81% / 38.29% of the initial linear error after 512 iterations, above the 5% linear target.

The current 18,069-coordinate derivative has a structural nullity of at least **12,834**, because most contacts stick and their velocity response factors through 1,818 body coordinates. Individual contact blocks remain well behaved. This points toward a body-space correction or active-contact strategy; bounded solves and a reduced adjoint residual do not prove inconsistency or physical nonexistence.

The [isolated typed Newton comparison](../benchmarks/experiments/glass-tick117-newton-linear-20260917-01/README.md) passes strict TypeScript and twelve small physical cases. Its historical best retained large impulse measures **3.95564e-6 m/s**, above the unchanged **1e-6 m/s** physical gate, with 85 failing contacts and friction also above the gate. No new proposal is applied or promoted. Accepted replay remains **tick 116**.

The [matched Newton handoff screen](../benchmarks/experiments/glass-tick117-newton-handoff-20260917-01/README.md) first verified that better numerical starts help but are insufficient. The [local correction prototype](../benchmarks/experiments/glass-tick117-local-correction-20260917-01/README.md) passes fourteen derivative/guard controls and twelve small physical cases, but redistributes the large system's error without lowering its maximum. These saved-seed investigations include all preceding seed costs. Accepted live replay remains **tick 116**; production and runtime defaults remain unchanged.

The [matched initialization comparison](../benchmarks/experiments/glass-tick117-seed-comparison-20260917-01/README.md) shows that a fresh numerical start alone does not fix the retained later tick-117 problem: both zero and cached starts exhaust 10,240 ordinary maps on the same **6,023-contact / 303-body** system. Independent best errors are 1.97168e-5 and 8.47492e-5 m/s against the unchanged 1e-6 m/s gate. The cached result exactly reproduces the retained failure. Neither vector is applied.

The [independent residual audit](../benchmarks/experiments/glass-tick117-residual-audit-20260917-01/README.md) localizes the best high-accuracy reference's remaining error to **31 contacts, 16 dynamic bodies and 14 body pairs**. All 31 failures are normal-contact errors; friction passes everywhere. The worst error is **5.48933e-6 m/s**, with several failing contacts involving body 17. No affected row has a static participant or negative speculative target. These error-selected groups remain coupled to the full physical island. The later local correction and Newton studies are summarized above; this 31-contact localization applies to the preserved half-reference vector, not the newer Newton vectors.

The [guarded outer-correction extrapolation](../benchmarks/experiments/glass-tick117-outer-anderson-20260917-01/README.md) passes sixteen policy/math controls, twelve exact default-disabled comparisons and all twelve manufactured physical cases. It reduces their total reference outer updates from **215 to 32 (85.12%)**, but worsens the retained large case and is not promoted. Uniform quarter relaxation regresses a manufactured case; direction-sensitive damping never activates because the large-case correction directions remain aligned. The detailed failed outcomes and all impulses are retained. These are reference investigations, not an engine-wide speedup or a self-contained runtime solution.

Accepted live replay remains **tick 116**. The previous enabled cached-start continuation timed out at **300.3100 seconds before completing tick 117**. Production source, roadmap qualification counts, full-trajectory and interactive-performance qualification remain unchanged. The reference restarts also retain the preceding failed seed's 10,240-map cost; no restart is presented as a free initialization.

The [optional cached-start mode](../benchmarks/experiments/glass-cached-seed-integration-20260917-01/README.md) passes strict TypeScript and **155 focused tests**, preserving exact zero-mode behavior and four disabled replay ticks plus their endpoint. On the saved 6,039-contact case it reduces ordinary work from **7,049 to 5,322 maps (24.50%)** and passes actual body application, with independent contact error **9.93662e-7 m/s** and 80-digit mass/inertia agreement within **9.48e-15 m/s**. Zero remains the default. This fixed-case result is not an engine-wide speedup. The [standalone cached-start screen](../benchmarks/experiments/glass-cached-seed-screen-20260917-01/README.md) remains a fixed-case result.

The [strictly typed collision integration](../benchmarks/experiments/glass-seeded-moving-integration-20260917-02/README.md) now passes enabled simulation replay through **tick 116**, advancing the accepted trajectory from tick 114. All **14 contact solves and compensated applications** succeed across ticks 115-116, with an exact checkpoint restart at tick 115. Worst normal and friction errors remain below 1e-6 m/s, maximum independently checked overlap is **2.00122e-5 m** against the unchanged 0.0005 m limit, and CCD has no unresolved events. Energy, finite-state and clamp checks pass.

The default-off engine candidate passes strict TypeScript, **148 focused tests**, 36 manufactured physical checks and four exact disabled replay ticks plus their complete endpoint. Its actual saved-island solve and application reproduce the qualified pipeline, including independent 80-digit mass/inertia agreement within **7.90e-15 m/s**. Numerical zero initialization is kept separate from cached physical impulses; one factor is shared within each solve and rebuilt on the next call.

Runtime remains the main limitation: the two-tick enabled replay takes **211.0003 seconds**, with **33,031 ordinary maps, 8,239 least-squares solves and 20,825 trial evaluations**. The cached-start screen and its still-unqualified later replay are summarized above; every physical gate remains unchanged. Accepted restart state is the new tick-116 checkpoint. Production, roadmap qualification counts, full-trajectory and interactive-performance qualification remain unchanged.

The [self-contained collision pipeline](../benchmarks/experiments/glass-seeded-moving-pipeline-20260917-01/README.md) now generates its starting estimate directly from current contact inputs and passes the saved **6,039-contact / 290-body** system through actual body application. It exactly reproduces the qualified starting estimate and final impulses while sharing **one sparse factorization** between stages. Each new call rebuilds the factor, so changed contacts cannot inherit a stale factor. Thirty-six manufactured solves, twenty-four exact regenerated estimates, twelve shared/separate-factor controls and twenty-four guards pass; independent physical checks pass too.

The complete large solve costs **7,049 ordinary maps, 1,747 least-squares solves and 5,776 trial evaluations**, taking **59.4512 seconds** including starting-estimate generation. After application, independent contact error remains **9.70115e-7 m/s** and 80-digit mass/inertia agreement is within **7.90e-15 m/s**. This is a fixed-system numerical qualification, not an interactive-performance result. The later typed island integration and bounded replay through tick 116 now pass as summarized above. The qualified numerical start is zero; physical cached impulses remain separate for free-state reconstruction and delta application. Production and roadmap qualification counts remain unchanged.

The [JavaScript moving-contact solver](../benchmarks/experiments/glass-moving-cone-js-20260917-06/README.md) now qualifies the saved tick-115 attempt-16 system with **6,039 contacts and 290 dynamic bodies**. Its independent original contact error is **9.70115e-7 m/s**, below the unchanged 1e-6 limit; normal impulses, friction feasibility and decreasing contact energy pass. It reuses one sparse factor for **5,001 ordinary inner maps over 27 outer iterations**, with 1,235 least-squares solves and 4,072 trial evaluations. Generating the saved starting estimate costs another 2,048 ADMM maps, 512 least-squares solves and 1,704 trial evaluations.

Its [actual body application](../benchmarks/experiments/glass-moving-cone-js-application-20260917-01/README.md) also passes: independent 80-digit mass/inertia arithmetic agrees with applied velocities within **7.90e-15 m/s**, original contact error remains **9.70115e-7 m/s**, and contact energy decreases 0.0230505 J. Rejected proposals, accepted-copy isolation and one-shot application preserve the required state boundaries.

Twenty-four exact disabled controls, twelve known roots, twelve cold manufactured solves, twelve disabled isolation cases and eighteen guards pass in the qualifying solver packet. Independent inner, outer, auxiliary-state and acceleration checks pass. Controlled predecessor failures are preserved: [inner acceleration at cap 10](../benchmarks/experiments/glass-moving-cone-js-20260917-03/README.md), [cap 100](../benchmarks/experiments/glass-moving-cone-js-20260917-04/README.md) and [forcing 0.5](../benchmarks/experiments/glass-moving-cone-js-20260917-05/README.md). The successful successor changes only intermediate forcing to 0.75; final physical tolerances stay unchanged.

These are fixed-system results. The two-case solver probe takes **54.2577 seconds** and does not qualify interactive performance. Starting-estimate generation, typed island integration and replay through tick 116 now pass in the later packets above; full trajectory validation remains open. Production and accepted live replay at **tick 114** remain unchanged; roadmap qualification counts are unchanged.

The [moving-contact reference](../benchmarks/experiments/glass-moving-cone-reference-20260917-06/README.md) now qualifies the saved tick-115 attempt-16 system with **6,039 contacts and 290 dynamic bodies**. A cap-10-seeded proposal reaches **9.32792e-7 m/s** worst original contact error, below the unchanged 1e-6 m/s limit, with feasible friction and decreasing contact energy. The independent Python reference and frozen Node engine agree. This takes fifteen outer updates and sixteen inner solves, including one retry, in addition to the earlier 2,048 ADMM maps and acceleration work used for the seed. The zero-start case still fails.

The [fixed-body application proof](../benchmarks/experiments/glass-moving-cone-application-20260917-01/README.md) then passes the unchanged engine certificate and compensated application on reconstructed bodies. Independent 80-digit response and mass/inertia calculations agree with applied velocities within **3.31e-14 m/s**; the original contact error remains **9.32792e-7 m/s**, and contact energy decreases 0.0230505 J. Rejected proposals leave state exact, accepted output is isolated from provisional mutation, and repeated application is rejected. These are fixed-system results. Accepted live replay remains **tick 114**; production and runtime/FPS qualification remain unchanged.

The [residual-dependent inner policy](../benchmarks/experiments/glass-moving-cone-reference-20260917-05/README.md) first recovers all twelve manufactured solves and reduces the seeded large-case error to 2.74769e-6 m/s, but stops at its intermediate accuracy gate. The controlled successor changes only its forcing fraction from 0.05 to 0.25 and analytic expected budgets. Final normal/friction/cone/energy limits are unchanged; all twelve policy checks, seven corrected-cone checks and twelve manufactured solves pass again. The qualifying JavaScript implementation and body application are summarized above; general runtime integration and replay qualification remain open.

The preceding [contact-residual extrapolation](../benchmarks/experiments/glass-admm-residual-extrapolation-20260917-01/README.md) remains rejected for a roughly ninefold worse large-case error. The [static force-balance reference](../benchmarks/experiments/glass-static-cone-tick115-20260917-01/README.md) reports numerical PrimalInfeasible for an all-resting state; that is not an exact infeasibility certificate and does not rule out the moving solution now found. Earlier [strict inner checks](../benchmarks/experiments/glass-moving-cone-reference-20260917-03/README.md) and [precision refinement](../benchmarks/experiments/glass-moving-cone-reference-20260917-04/README.md) failures remain preserved.

The earlier [full-state ADMM acceleration](../benchmarks/experiments/glass-admm-anderson-20260917-01/README.md) passes **72 manufactured solves**, 24 exact disabled controls, 15 guards, 75 independent original ADMM map checks and 17 independent acceleration-trial checks. On the saved tick-115 attempt-16 problem, it reduces the independently reconstructed worst contact residual from 2.97933e-5 to **1.26644e-5 m/s**, about **57.5%**, at the same 2,048 ordinary-map limit. Nonnegative normal impulses, friction-cone feasibility and decreasing contact energy are preserved, but the proposal still fails the unchanged 1e-6 m/s original-law gate. The prototype adds 512 least-squares solves and 1,704 trial contact evaluations; no runtime/FPS improvement is qualified.

A [controlled larger-cap screen](../benchmarks/experiments/glass-admm-anderson-cap-20260917-01/README.md) repeats the independent math checks but gives a worse 1.35593e-5 m/s large-case residual with 1,936 trial evaluations. The [saved-contact audit](../benchmarks/experiments/glass-admm-contact-audit-20260917-01/README.md) finds 318 failing contacts at cap 10 versus 413 disabled and 341 at cap 100. The cap-10 failures span 179 bodies and both sticking and boundary friction behavior. That direction was tested by the contact-residual extrapolation summarized above. Accepted physical replay remains **tick 114**; failed proposals are unapplied, production source and roadmap counts are unchanged.

The earlier [body-level Newton preconditioner](../benchmarks/experiments/glass-newton-body-preconditioner-20260917-01/README.md) passes **52 known linear solutions**, six rejection guards, 48 independent small dense references and four captured geometry/mass checks. Maximum original shifted-operator relative residual is 3.45424e-11. It makes all 32 Newton linear solves converge in each tested shift, but every resulting Newton trial is rejected and the outer solve falls back to gradient steps. No physical proposal qualifies. The [preceding polishing screen](../benchmarks/experiments/glass-admm-newton-polish-20260917-01/README.md) reaches 3.99935e-6 m/s from the retained ADMM seed and also fails friction feasibility.

An [independent direction audit](../benchmarks/experiments/glass-newton-direction-audit-20260917-01/README.md) verifies 15 line-search trials and four exact prior observations. The accurate Newton direction is about 2,079 times larger than the local correction; a step fraction of 2^-24 is accepted but yields negligible progress. The [damped correction screen](../benchmarks/experiments/glass-shifted-newton-20260917-01/README.md) then accepts 16 and eight numerical updates, yet its best independent residuals remain 5.50409e-6 and 2.32530e-5 m/s with infeasible provisional impulses. All failed proposals stay unapplied. The accepted trajectory remains **tick 114**; the subsequent full-state ADMM studies are summarized above. Physical tolerances, production source, roadmap counts and runtime/FPS qualification remain unchanged.

The [optional sparse cone integration](../benchmarks/experiments/glass-sparse-integration-20260917-02/README.md) passes strict TypeScript, **140 focused tests**, four actual rigid-body applications checked against independent 80-digit response/mass references, four exact disabled control ticks and the complete control endpoint. The continuation crosses the former capacity boundary and passes **ticks 113-114**, with seven accepted compensated applications, 3,397 direct solves and no Newton/PCG/ADMM fallback in those completed ticks. Maximum normal residual is 9.86566e-7 m/s and independent overlap is 9.18509e-9 m. The accepted tick-114 state is preserved. Tick 115 reaches the replay's 300-second cap after nonlinear convergence failures; the planned tick-116 restart and full 113-120 window remain unqualified.

The [sparse fixed-system proof](../benchmarks/experiments/glass-sparse-body-solve-20260917-02/README.md) passes 12 known LU solutions, eight LU rejection guards, 33 independent body solves, ten body-solve guards and four complete contact proposals. On the captured 264-body case, the sparse factor stores 547,898 entries and uses 58,197,950 elimination multiply-adds versus 1,323,527,304 for the dense algorithm: a **95.6% reduction in counted factorization multiply-adds**. Pivot search, graph ordering, assembly and triangular solves are separate work; this is not a CPU/FPS claim. Dense remains the default. Sparse entry/work/pivot limits, original-operator verification and all physical tolerances remain intact.

The [tick-115 ADMM diagnosis](../benchmarks/experiments/glass-sparse-admm-tick115-20260917-01/README.md) completes 4,096 accurate direct solves on a retained 290-body problem, with maximum linear velocity error below 8e-13 m/s and no PCG fallback, but both outer solves still miss contact tolerance. A [four-setting numerical penalty screen](../benchmarks/experiments/glass-sparse-admm-penalty-20260917-01/README.md) exactly reproduces its baseline and reduces the best independent residual from 0.000504482 to 0.0000297933 m/s. Every setting still fails the unchanged 1e-6 gate and remains unapplied. The next work targets bounded nonlinear polishing/acceleration on this fixed case before application and replay. Production source, roadmap counts, full-trajectory/natural-release acceptance and native/CPU/FPS qualification remain unchanged.

The earlier [zero-start and compensated-application candidate](../benchmarks/experiments/glass-compensated-application-20260917-01/README.md) passes strict TypeScript, **132 focused tests**, three actual applications checked against 80-digit packed-response and physical-mass references, four exact disabled control ticks and their complete endpoint. The continuation now passes **ticks 103-112**, with an exact physical/cache/birth restart at tick 110, 25 accepted compensated island applications and no Newton/PCG/ADMM fallback. Maximum normal residual is 9.99861e-7 m/s and maximum independent overlap is 7.90094e-9 m. Tick 113 is deliberately interrupted before its first 264-body proposal exceeds the explicit 1,536-coordinate capacity. The accepted tick-112 checkpoint and complete incoming contacts/solver data are preserved; the full release window remains open.

The [zero-start fixed-system proof](../benchmarks/experiments/glass-cone-zero-start-20260917-01/README.md) reduces the earlier proposal work from 48 to 36 updates and from 637 to 186; the larger tick-103 case now converges in 298 updates where the warm proposal failed after 2,048. This changes only the provisional guess on the same free-state equations. A [retained application audit](../benchmarks/experiments/glass-zero-application-audit-20260917-01/README.md) then isolates repeated-update rounding; compensated application lowers the largest packed-response mismatch from 1.09247e-9 to 1.61791e-10, passing the unchanged 1e-9 consistency gate. All options preserve their legacy defaults. That ten-tick continuation motivated the sparse work above: it used about 16.1 billion dense-factor multiply-add operations. Production source, roadmap counts, full-trajectory/natural-release acceptance and native/CPU/FPS qualification remain unchanged.

The [independent static-cone reference](../benchmarks/experiments/glass-static-cone-reference-20260917-01/README.md) proves a valid friction/contact solution exists for the first tick-101 failure. The [JavaScript cone proposal](../benchmarks/experiments/glass-cone-proposal-20260917-01/README.md) now passes both captured systems in 48 and 637 updates, with independent full-contact residuals 3.94011e-7 and 9.67465e-7 m/s and passing free-energy gates. Six guard/behavior checks include rejection of an incorrect sliding associated-law solution without output mutation. That packet qualified fixed-system proposals only; the later integration and actual-application evidence is summarized above.

The [body-coordinate solver](../benchmarks/experiments/glass-body-shifted-solve-20260917-04/README.md) reduces the captured shifted system from 7,101 contact coordinates to 444 body coordinates. All 33 independent linear-reference checks pass; the captured 2,367-contact solve passes its original residual and energy gates after 281 ADMM/direct solves. Its [default-off integration](../benchmarks/experiments/glass-body-shifted-integration-20260917-01/README.md) passes 105 tests, 12 exact disabled systems, an exact PCG fallback, four exact control ticks and an endpoint. The candidate crosses the former stall through ticks 98-100 and restores tick 100 exactly, but tick 101 fails outer contact convergence despite accurate linear solves. The accepted tick-100 checkpoint and failed trace were retained; the later cone and application work is summarized above. Production, roadmap counts, full trajectories, native acceptance and CPU/FPS qualification remain unchanged.

The [initial-contact restitution candidate](../benchmarks/experiments/glass-born-contact-restitution-20260915-03/README.md) now tracks original glass cut pairs through separation, re-impact, adaptive rollback and restart. Strict TypeScript and 101 tests pass. Four control ticks and one prior complete endpoint remain exact; all eight completed candidate ticks (90-97) satisfy the original contact gates, with 12 fresh geometry samples across control and candidate. The former tick-94 failure now passes with 2,367 Newton inner iterations and no ADMM work. A [two-target isolation](../benchmarks/experiments/glass-release-restitution-isolation-20260915-01/README.md) independently verifies the underlying response and energy correction. The candidate times out during tick 98 at the unchanged 300-second cap, so the release window remains incomplete. The later first-request capture identifies IC0 capacity fallback and a failed original linear solve; the body-coordinate continuation above moves the failure to tick 101. Production v4, roadmap counts, full trajectories, native acceptance and CPU/FPS qualification remain unchanged.

The [post-fracture trace](../benchmarks/experiments/glass-single-axis-release-trace-20260915-01/README.md) reproduces the three qualified impact ticks and endpoint exactly. Tick 93 passes, but tick 94 fails after 980,644 ADMM inner iterations despite valid geometry. The [independent normal-feasibility certificate](../benchmarks/experiments/glass-release-normal-feasibility-20260915-02/README.md) identifies two incompatible rebound targets between newly released, still-touching glass pieces. Within a conservative bound derived from the available kinetic energy, normal residual cannot fall below 0.0038166726 m/s, versus the unchanged 1e-6 limit. The first unbounded LP discrepancy is retained and explicitly reproduced. A scoped fracture-release restitution correction is the next step; increasing iteration counts cannot resolve this captured inconsistency. Production remains unchanged.

The [single-axis integration](../benchmarks/experiments/glass-single-axis-integration-20260915-01/README.md) now passes 93 focused tests, 104 independently checked direct applications, 96 mixed-body energy systems, 48 exact control ticks, two exact control endpoints and 96 fresh geometry samples. In thick ticks 76-120 and laminated ticks 90-92, the four direct island solves need no Newton or ADMM inner iterations and reduce maximum normal residuals to about 2e-15 m/s. The [qualified total contact-energy certificate](../benchmarks/experiments/glass-contact-energy-certificate-20260915-01/README.md) keeps warm-start work separate from total impact energy and preserves the original contact tolerance and total-energy gate. Both flags remain default-off. Post-fracture convergence, full trajectories, native runtime and controlled CPU/FPS qualification remain open; production v4 and roadmap counts are unchanged.

The [pendulum response study](../benchmarks/experiments/glass-pendulum-response-20260915-01/README.md) passes 77 focused tests, 256 exact rigid-body controls, 512 pendulum callback cases and 96 independent generalized-mobility matrices. Its [trajectory replay](../benchmarks/experiments/glass-pendulum-contact-replay-20260915-01/README.md) reproduces all 210 retained control ticks and both endpoints exactly, but the new response still misses contact tolerance. The [unchanged laminated trace](../benchmarks/experiments/glass-pendulum-old-timeout-trace-20260915-01/README.md) localizes the existing timeout to ADMM at tick 100, with 2,382 contacts; both old and candidate runs retain tick-99 checkpoints and in-flight inputs. Small geometric overlap does not qualify these large residuals.

The [independent energy-reference diagnosis](../benchmarks/experiments/glass-pendulum-energy-reference-20260915-01/README.md) verifies 104 single-axis roots and proves that two captured rebound states cannot meet both the original 1e-6 m/s normal tolerance and the energy gate measured from an already warmed/scalar-updated state. Their minimum required kinetic increases are 0.0000428867 J and 0.000686558 J versus a 1e-8 J limit, although both proposals dissipate energy relative to the reconstructed unconstrained contact state. The two rejected applications remain unapplied. The later energy-certificate and single-axis integration packets qualify this correction for the stated fixed systems and early-impact windows; no tolerance was relaxed. Production v4, roadmap counts, full trajectories, longer settling, native acceptance and timing qualification remain unchanged.

The [full initial-condition hybrid run](../benchmarks/experiments/glass-hybrid-full-20260915-01/README.md) remains incomplete after a 300-second laminated-retention timeout. Three serialized-restart tests pass; retained checkpoints cover 570 ticks and nine geometry samples. Thick-panel tick 76 and laminated tick 90 miss the 1e-6 normal-contact tolerance on unsupported contacts, with no Newton or ADMM attempts. The pendulum's constrained callbacks currently exclude it from prepared/island response. Its response needs proper generalized-motion support; the later timeout still needs a bounded trace. Full-trajectory and runtime qualification remain open.

The [identical-graph timing calibration](../benchmarks/experiments/glass-hybrid-timing-calibration-20260915-01/README.md) was rejected: 120 exact state/cache checks passed, but one identical-settings pair had a 1.4684 elapsed-time ratio outside the unchanged 0.9-1.1 limit. Medians do not override that all-pair failure. The runner stopped before the other two contexts; no guard-enabled speed comparison ran. The next gate is complete initial-condition physics coverage.

The [Newton progress guard](../benchmarks/experiments/glass-hybrid-progress-guard-20260915-01/README.md) removes 12,288 wasted Newton inner iterations from the radial window while preserving prior physical observations, full final body/cache states, all 39 successful Newton solves, and ADMM/IC work. Radial combined inner counts fall from 44,176 to 31,888; this is a 27.8% count reduction, not a CPU/FPS claim. Strict TypeScript, 68 focused tests, six independently checked body applications, 180 fresh geometry samples and six final checkpoint checks pass. Fresh controls preserve 90 full prior records; all 180 fresh physical records and six prior endpoints match exactly. Another 360 control samples are retained with provenance. The earlier first-inexact-linear guard timed out and remains rejected. Controlled timing, full presets, longer settling and native runtime gates remain open; production and roadmap counts are unchanged.

The [certified Newton / ADMM hybrid](../benchmarks/experiments/glass-hybrid-newton-admm-20260915-01/README.md) passes all original thirty-tick moving gates in radial, tempered and edge-strike glass. Newton handles 39 of 43 island solves; four radial islands use ADMM, and no final solve falls back or exhausts its budget. Strict TypeScript, 61 tests, four independently checked body applications, 270 fresh geometry samples and nine exact final checkpoints pass. Six unchanged ADMM controls reproduce 180 prior records and six full endpoints; 180 scalar samples are explicitly reused. Tempered and edge avoid IC work, but their positive fragment-energy steps are larger than IC-only ADMM while staying inside the original limits. Radial still wastes work in failed Newton steps. No CPU/FPS gain or production adoption is qualified.

The [IC-preconditioned moving solver](../benchmarks/experiments/glass-admm-ic0-integration-20260914-01/README.md) passes all original gates in thirty-tick radial, tempered and edge-strike windows with no fallback or exhausted exit. Inner iterations fall by 54.62–70.70% versus the qualified diagonal ADMM baseline. Strict TypeScript, 51 focused tests, two independently checked body applications, 360 geometry samples and twelve exact final checkpoints pass. All 270 prior records and nine prior full endpoints remain exact. Additional factor work and more island rescues remain significant; no CPU/FPS gain is qualified. Full presets, longer settling and native/runtime gates remain open. Production and roadmap counts are unchanged.

The [moving ADMM pipeline](../benchmarks/experiments/glass-admm-stability-20260914-01/README.md) now passes thirty-tick radial, tempered and edge-strike windows at the original 1e-6 m/s joint tolerance, with zero ADMM fallback or exhausted exit. All geometry, fixed-clamp, settled-motion, energy and declared work gates pass. Peak positive fragment-energy steps are more than 99.7% lower than baseline in these windows. Across candidate and controls, 270 independent geometry samples pass; 45 prior records and nine complete prior endpoints remain exact. Nine saved final checkpoints also decode and match their endpoints exactly.

The [atomic integration](../benchmarks/experiments/glass-admm-integration-20260914-01/README.md) passes strict TypeScript and 44 focused tests, including unbiased energy rejection, corrupt output handling, unsupported custom-response fallback and certified application. Its numerical core remains unchanged from the fixed-state candidate. Global solver work is still substantial; no CPU/FPS gain is qualified. Full initial-impact presets, longer settling, native runtime and controlled performance remain open. The live v4 engine and roadmap counts are unchanged.

The [TypeScript ADMM candidate](../benchmarks/experiments/glass-island-admm-forcing-20260914-02/README.md) now passes the original contact, friction and energy gates in all three captured systems. Strict TypeScript, ten mathematical test families, 181 exact prior states, 181 independent Python states and 987 independently reconstructed inexact inner solves pass. Fourteen captured physical observations are independently verified. Warm radial uses 60.68% fewer response products and tempered 73.27% fewer than the strict diagonal TypeScript control; cold radial now converges where that control exhausts its inner budget. These are algorithmic work counts, not engine CPU/FPS gains. The candidate is not installed in the live engine. Moving-state qualification, native runtime and controlled timing remain open; production v4 and roadmap counts are unchanged.

The [strict matrix-free implementation](../benchmarks/experiments/glass-island-admm-pcg-20260914-03/README.md) preserves the direct reference's warm convergence but requires excessive inner work and fails cold initialization. [Pair-block preconditioning](../benchmarks/experiments/glass-island-admm-pairs-20260914-01/README.md) does not resolve that limit. The selected fixed-state candidate instead verifies a progressively tighter linear-error bound in physical velocity units while retaining the original final physical gate. Its preceding looser forcing screen is retained because tempered remained above tolerance.

The [converged ADMM reference](../benchmarks/experiments/glass-island-admm-convergence-20260914-01/README.md) now passes the original 1e-6 m/s contact gate, friction feasibility and energy gates in all three fixed captured systems. Warm radial takes 642 updates, cold radial 590, and tempered 377 with one fixed penalty rule. Fourteen sequential children, 29 independent physical observations and 19 exact prior control states pass; five unchanged mathematical test families are source-verified and reused. This is a SciPy sparse-factorization reference. TypeScript implementation, moving-scene qualification and controlled performance remain open; production v4 and roadmap counts are unchanged.

The [contact-informed initialization](../benchmarks/experiments/glass-island-admm-initialization-20260914-01/README.md) reduces tempered updates from 468 to 105 at the larger penalty, but that penalty still fails warm radial in the extended screen. The [equivalent full-cone Newton formulation](../benchmarks/experiments/glass-island-cone-residual-20260914-01/README.md) passes 23 mathematical test families and 166 exact controls while retaining the radial failure. These results motivated the independently verified proximal ADMM method, without changing physical compliance or tolerances.

The [cone-constrained radial reference](../benchmarks/experiments/glass-radial-constrained-reference-20260914-04/README.md) passes six mathematical test families and independently verifies six captured correction checkpoints, including three byte-identical controls from a retained export failure. Its final feasible proposals reduce squared-residual merit to 52.71% and 48.45%, but maximum contact residuals remain 1.01e-4 and 6.79e-5 m/s, above the original 1e-6 gate. The initial worst contact worsens. Neither linear solve meets its 0.05 target after 2,048 updates, and the nonzero gradient mappings are not an infeasibility certificate. No proposal is committed; production and roadmap counts remain unchanged. The next work separates constrained-linear convergence from active-branch error and addresses the worst contact directly.

The [full radial Newton reference](../benchmarks/experiments/glass-radial-newton-reference-20260914-01/README.md) shows that accurate linear solves alone do not resolve this case. All 32 direct solves meet their linear target, but the final contact residual is 7.36e-5 m/s and the impulses fail feasibility. Sixty-six sequential children and 528 exact replayed prefix observations pass. A [read-only line-search trace](../benchmarks/experiments/glass-radial-line-search-20260914-01/README.md) reproduces 33 complete states and 50 decisions: full corrections cross contact branches, and the final 18 Newton steps are rejected. Cone projection rescues those trial decisions only at very small step lengths.

The [spectral direction screen](../benchmarks/experiments/glass-radial-spectral-reference-20260914-01/README.md) independently verifies 24 corrections at the initial and first-stalled states. Damping permits full projected steps and reduces squared-residual merit, but the worst contacts still miss the original tolerance; the initial worst contact worsens. The [zero-fill sparse preconditioner](../benchmarks/experiments/glass-sparse-ilu-20260914-01/README.md) also fails both warm captured linear systems despite passing 23 mathematical test families, six exact controls and 18 sparse product checks. None of these diagnostic variants changes production or qualifies a CPU/FPS gain. The subsequent cone-constrained result is summarized above.

The [independent radial linear reference](../benchmarks/experiments/glass-radial-reference-20260914-02/README.md) resolves the first captured linearization to 4.65e-12 relative residual when rechecked in the original matrix-free operator. Independent sparse assembly reproduces three products, with maximum absolute difference 7.11e-15. Two rank cutoffs return the same direction and effective rank 1,969 for 3,255 unknowns. This establishes numerical consistency of that linearization and confirms that the original iterative linear solve is inaccurate on it. Six bounded children pass, with peak resident memory about 242 MiB. Dense factorization is a reference only; subsequent nonlinear and sparse screens are summarized above. Full nonlinear radial convergence and production/performance qualification remain open.

The [exact first-linear trace](../benchmarks/experiments/glass-island-linear-trace-20260914-01/README.md) preserves 166 complete observations and identifies 1,078 sticking versus two sliding contacts in the warm radial system. Its first GMRES solve leaves 22–31% relative residual after 128 iterations. A [512-iteration least-squares diagnostic](../benchmarks/experiments/glass-island-linear-range-20260914-01/README.md) also fails radial and does not establish an incompatible active branch. An [equivalent normal-complementarity formulation](../benchmarks/experiments/glass-island-fischer-burmeister-20260914-01/README.md) passes 22 mathematical test families and 166 exact controls while retaining the original physical acceptance measure. Tempered projected pair trials pass with 425 inner iterations and 515 response products, compared with 1,106 and 1,228 in the original control. Radial remains unresolved. A [direct body-response proposal](../benchmarks/experiments/glass-body-response-20260914-01/README.md) passes 280 manufactured operator/solver systems but fails every captured contact screen and is rejected. The subsequent direct references are summarized above. Production and roadmap counts remain unchanged; no CPU/FPS gain is qualified.

The [bounded hybrid screen](../benchmarks/experiments/glass-island-hybrid-20260914-01/README.md) preserves 83 original Newton observations and 156 accelerated prefix states but leaves the radial inner solve stalled. An initial [pair-block preconditioner](../benchmarks/experiments/glass-island-pair-preconditioner-20260914-01/README.md) passes its mathematical checks but fails the captured nonlinear screens. Adding a [condition estimate guard](../benchmarks/experiments/glass-island-conditioned-pairs-20260914-01/README.md) restores tempered convergence: 18 focused test families and 83 exact original control observations pass. The captured tempered solve reaches 3.97e-7 m/s with feasible friction and no kinetic-energy rise, using 546 inner iterations versus 1,106 and 659 response products versus 1,228. Block preparation and multiplication add work, so a CPU/FPS gain is unqualified. Radial still exhausts its linear budget; neither new variant qualifies across all captured states. The next diagnostic separates conditioning from active-branch linearization error. Production v4 and roadmap counts remain unchanged.

The [projected Newton](../benchmarks/experiments/glass-island-projected-newton-20260914-01/README.md) and [regularized correction](../benchmarks/experiments/glass-island-regularized-20260914-01/README.md) screens retain the radial failure; regularization also regresses tempered convergence. The first [Anderson screen](../benchmarks/experiments/glass-island-anderson-20260914-01/README.md) rejects all radial acceleration proposals. A [read-only rejection trace](../benchmarks/experiments/glass-island-anderson-trace-20260914-01/README.md) reproduces 387 exact states and shows that 105 radial proposals improve contact error when shortened to the existing coefficient bound. The subsequent [clipped correction screen](../benchmarks/experiments/glass-island-anderson-clipped-20260914-01/README.md) passes 14 mathematical test families and 470 exact control observations. Tempered meets 1e-6 m/s with feasible friction and no kinetic-energy increase; radial improves about 16.4% but still fails tolerance, and cold radial also fails energy. No variant qualifies across all fixed states. Production v4 and roadmap counts are unchanged; no CPU/FPS gain is claimed.

The [exact radial network trace](../benchmarks/experiments/glass-island-radial-trace-20260914-01/README.md) confirms five complete observed/disabled states and both retained tight-scalar endpoints, plus an exact 33-state warm replay. Larger linear restart workspaces do not resolve its 1,085-contact failure. A subsequent [cold-initialization screen](../benchmarks/experiments/glass-island-coldstart-20260914-01/README.md) makes every inner linear solve meet its target, but all three settings fail the unchanged nonlinear residual and friction-feasibility gates; the larger widths also fail the captured energy gate. The next work targets nonlinear convergence on those frozen equations. Rejected candidates leave live bodies unchanged.

The [matrix-free global contact solver](../benchmarks/experiments/glass-island-newton-20260914-03/README.md) solves the captured 3,311-contact, 959-body network below 1e-6 m/s in sixteen nonlinear updates, with feasible friction and no kinetic-energy increase. Eight mathematical test families and independent residual/energy reconstruction pass. Its [dynamic integration screen](../benchmarks/experiments/glass-island-integration-20260914-01/README.md) passes 36 focused tests, fifteen exact original controls, three tight-scalar endpoints and sixty independent geometry samples. Early rescue meets the strict joint tolerance in tempered and edge glass, with no positive tempered fragment-energy step across that five-tick window. Radial still rejects all twenty attempts, so no variant qualifies across all contexts. The next work addresses its exhausted inner linear solves. Production v4 and roadmap counts stay unchanged; no CPU/FPS gain is claimed.

The [bounded-restart integration](../benchmarks/experiments/glass-cached-group-restart-20260914-02/README.md) passes 28 focused tests, six exact helper outputs with 97 observed iteration states, fifteen exact original control states, three exact tight-scalar endpoints and 75 geometry checks. One internal cold restart resolves two captured warm-start stalls without extending the update budget; delayed local fallback counts approximately halve. All fifteen physical screens pass, but the practical global energy/work/convergence gate still fails. Counts compare changed trajectories and do not establish runtime gains.

The [exact global exit trace](../benchmarks/experiments/glass-group-exit-trace-20260914-02/README.md) identifies the next cause: pair 302/669 solves below 1e-6 m/s, then neighboring contacts raise its normal residual to 0.000652866 m/s within the same final sweep. Its island contains 3,311 contacts and 959 dynamic bodies. Five complete observed/disabled states, ten prior observations and two endpoints agree exactly; independent arithmetic verifies both the local solution and final disturbance. The next solver experiment addresses whole-island coupling with bounded memory. Production v4 and roadmap counts remain unchanged.

The [qualified glass solver](../benchmarks/experiments/glass-sat-native-20260912-02/README.md) is now installed as `convex-contact-sat-js-f64-v4`. Forces are applied within collision substeps, and retained intermediate motion catches thin contacts during rotation or gravity reversal. The matched three-second pile test reduced median residual vertex motion by **81.62%** versus v3. Search reuse and scalar SAT construction preserve the qualified equations while removing repeated geometric work. This is a settling/geometry result, not a CPU or FPS multiplier.

All eight numerical presets pass over **11,520 ticks and 192 independent geometry samples**, with zero unresolved sweeps and maximum independently sampled overlap **0.197429 mm**. The current app completes radial and thick-panel runs in visible native WebGPU, passes two-angle inspection, pause, replay/Live and active reset, and downloads valid run data. Five overlapping exported samples, including the complete radial endpoint, match the independently checked browser trace exactly. **76 production regression tests**, full repository TypeScript and production bundling pass. Existing public media was reused rather than copied into the bundle check.

Exports now include the latest received collision frame even when it falls between replay samples. The actual paused download retains the 5.491666666666729-second endpoint after the preceding 5.483333333333396-second sample. The helper also passes 13 export/library tests and eight retained endpoint comparisons. Broader material contact coverage, long-term settling accuracy, calibrated fracture mechanics and controlled renderer-inclusive speed remain open.

The [long-settling continuation](../benchmarks/experiments/glass-long-settling-20260912-01/README.md) extends radial glass from 12 to 60 seconds and tempered glass from 12 to 30 seconds: 7,920 new ticks and 132 independent geometry checks. Both remain finite with fixed clamps, zero unresolved queries and sampled overlap below 0.038 mm. They fail the stricter settled-motion targets, and radial glass briefly rises 0.05308 J above its initial mechanical energy. Geometric clearance alone does not establish physically settled glass.

The [normal-convergence candidate](../benchmarks/experiments/glass-normal-convergence-20260913-01/README.md) reduces p95 vertex motion by 97.55% and 98.49% in fixed half-second late radial and tempered screens, without a mechanical-energy rise. It requires more solver work, reaches its iteration cap in some solves, and is not selected. A separate [coupled-friction candidate](../benchmarks/experiments/glass-friction-disk-20260913-01/README.md) fails the radial motion/energy screen. [Energy-stage accounting](../benchmarks/experiments/glass-friction-energy-20260913-01/README.md) reproduces the retained complete endpoint exactly and identifies potential-energy changes during position correction; it does not claim that all such correction is erroneous.

The [coupled normal-contact experiment](../benchmarks/experiments/glass-normal-block-20260913-01/README.md) passes 74 tests, strict TypeScript, exact compatibility/resume checks and both fixed late-pile screens. It reduces p95 motion by 97.84% and 98.34% relative to selected v4 in those half-second windows, with no measured mechanical-energy rise and sampled overlap below 0.021 mm. However, every paired local CPU and elapsed comparison is slower than the scalar convergence candidate beyond the declared 10% limit. It is rejected as a performance optimization and remains unselected. Profiling points to repeated contact velocity and impulse evaluation as the next target. A timing-harness byte-encoding error was reproduced and corrected using exact decoded-state and cache-order comparisons; the failed attempt is retained.

The earlier [browser arithmetic investigation](../benchmarks/experiments/glass-runtime-equivalence-20260912-01/DIAGNOSIS.md) explains why Node and browser endpoints differ despite identical inputs: a one-ULP pendulum atan2 difference appears at tick one. Browser numerical acceptance uses independent geometry checks; it does not require a false cross-runtime bitwise identity. The new current-app export reproduces that checked browser endpoint.

The glass material study now checks the pendulum on every swing and gives released pieces finite, rotating triangular-prism colliders. The pane, clamp pads, frame, tray and floor share dimensions with the visible apparatus. This addresses the previous single-impact trigger, ballistic shards, centre-only tray limits and forced flat landing orientation.

This is the JavaScript backend `convex-contact-sat-js-f64-v4`, used by the glass material study. Version 4 stages external forces within temporal subdivisions and retains intermediate swept motion. It preserves version 3's direction-independent friction, nearby supporting contacts during position correction, and consistent external/rigid-body translation correction. It retains version 2's duplicate-support removal and distinct cached-contact identities, including invalidation when a participant changes between held and free. It does not replace the native rigid-body backend or qualify collision in the other studies. Fracture initiation, crack propagation, launch velocities and retaining-layer forces remain authored comparative approximations.

The [prepared contact-response experiment](../benchmarks/experiments/glass-contact-response-20260914-01/README.md) passes 72 tests, candidate TypeScript, compatibility/resume checks and all eight full preset geometry runs: 11,520 ticks, 192 independent samples, zero unresolved queries and maximum sampled overlap 0.141553 mm. Three own-trajectory continuations add 1,080 ticks and 36 samples and pass the fixed motion/total-energy screens; separate fragment-energy rises reach 0.000219103 J. An [exact five-tick energy trace](../benchmarks/experiments/glass-response-energy-20260914-01/README.md) attributes the largest positive tempered step mainly to small upward velocities after contact solves reach their sweep ceiling. Raising the ceiling to 64 reduces that screen's largest positive step by 73.41% with 26.61% more row work, but some islands still miss tolerance. The larger tempered and edge-strike travel comes with one fully escaped fragment supported by the room floor in each case, while p95 residual fragment motion is much lower. The scalar-reference timing diagnostic passes calibration, but direct v4 timing remains inconclusive after correction of a reproduced benchmark object-lifetime issue. The candidate remains unselected pending improved convergence, broader energy/accuracy and runtime qualification.

The subsequent [joint-convergence candidate](../benchmarks/experiments/glass-joint-convergence-20260914-01/README.md) adds friction stationarity to stopping and preserves a consistent positive normal guess across a speculative-contact transition. All 72 existing tests and strict TypeScript pass. Over three additional seconds from shared radial, tempered and edge-strike states, 1,080 ticks and 36 independent geometry checks pass. Tempered peak fragment-energy rise falls 81.89%, p95 residual motion falls 82.81%, and normal-row visits fall 42.70%; radial and edge-strike every-tick observations and full endpoints remain exact. Friction residual checks add work, so runtime improvement is unqualified. Residual energy/convergence errors and native acceptance keep this variant experimental and unselected; its full initial-fracture trajectories are qualified in the following continuation.

The [full joint-convergence matrix](../benchmarks/experiments/glass-joint-full-20260914-01/README.md) now passes all eight presets from their initial states: 11,520 ticks, 192 independent geometry samples, finite state, stable clamps and zero unresolved queries. Maximum accepted penetration is 0.199425 mm and maximum independent sampled overlap is 0.161716 mm, within the unchanged 0.5 mm limit. Every tick also has an independently calculated rigid-energy observation; authored fracture input and compliant retention energy are not calibrated by this accounting.

The subsequent [friction-residual pruning candidate](../benchmarks/experiments/glass-friction-residual-prune-20260914-01/README.md) passes 72 unchanged tests, strict TypeScript, 395 exact state/cache/impact comparisons and 21,482 exact custom callback invocations. It skips pure cached friction measurements after normal error has already ruled out stopping, preserving full final-sweep diagnostics. Evaluation counts fall 89.77% in the retained five-tick tempered sequence and 73.87% across eight thirty-tick endpoint comparisons, each including serialization and restoration. These are work counts; controlled runtime, longer settling and native acceptance remain open. Production v4 and roadmap counts are unchanged.

The [full pruned joint-solver qualification](../benchmarks/experiments/glass-pruned-full-20260914-01/README.md) passes all eight initial-condition presets: 11,520 per-tick energy observations, 192 independent geometry/motion observations, and eight complete final physical/cache states exactly match the unpruned joint solver. Friction residual evaluations fall from 1,631,342,196 to 179,626,007 (88.99%), with unchanged normal diagnostics, refinement counts and final friction errors. Maximum independent overlap remains 0.161716 mm, within the unchanged 0.5 mm gate; unresolved queries remain zero. This establishes complete preset geometry and retained-observation/endpoint equivalence, not unsampled intermediate-state equality or a CPU/FPS gain. The [ten-context runtime experiment](../benchmarks/experiments/glass-pruned-timing-20260914-01/README.md) passes twenty exact golden warm-start/endpoint checks and 120 timed-trial state checks, but stops on a wired-retention identical-code CPU ratio of 0.868837, outside the unchanged 0.9–1.1 band. Its runtime classification is inconclusive; the [completed constructor diagnostic](../benchmarks/experiments/glass-timing-calibration-20260914-01/README.md) reproduces a 16% apparent intact CPU gain with byte-identical source under separate constructor graphs. All 192 diagnostic state checks pass. The [independent-process control](../benchmarks/experiments/glass-isolated-calibration-20260914-01/README.md) removes that intact bias and passes all 240 state checks and CPU pairs, but one wired elapsed ratio (0.899460) still fails the unchanged 0.9 lower bound. Candidate timing remains unexecuted. The [own-trajectory settling screen](../benchmarks/experiments/glass-pruned-own-settling-20260914-01/README.md) now passes 1,080 additional ticks and 36 independent samples from twelve to fifteen seconds in radial, tempered and edge-strike. Maximum sampled overlap is 0.020750 mm; temporal p95 vertex speeds are 0.447212, 0.084738 and 0.070530 mm/s. Total energy stays below its continuation starting value, but direct fragment-energy rises reach 0.845811 mJ and still require attribution. Longer settling, native acceptance and timing remain open.

The [own-trajectory energy trace](../benchmarks/experiments/glass-pruned-energy-20260914-01/README.md) now exactly replays 577 recorded measurement sets and fifteen complete endpoints in both observer modes. Its 390-row ledger attributes the three largest fragment-energy increments mainly to upward motion during integration, with no pendulum impulses in the fifteen traced ticks and negligible position-correction work at the focal ticks. All three focal solves terminate within 1e-4 m/s, unlike the earlier cap-bound peak. The [fixed-tolerance diagnostic](../benchmarks/experiments/glass-contact-tolerance-20260914-01/README.md) passes fifteen exact controls and sixty independent geometry checks, but rejects all tighter settings: 1e-6 reduces summed positive increments by 79–88% while needing up to 21.27 times normal-row work and still missing tolerance. Improved coupled convergence is required; no new source is selected and no runtime multiplier is established. Production v4, roadmap counts, longer-settling and native acceptance remain unchanged.

The [cached normal-block screen](../benchmarks/experiments/glass-cached-normal-block-20260914-01/README.md) passes 21 focused tests, strict TypeScript, fifteen exact original controls, three exact tight-scalar endpoints and 75 independent geometry samples. All three block settings fail the unchanged practical convergence gate. Delayed tight blocks reduce positive fragment-energy sums by 86–97%, but require up to 21.27 times the original normal-row work and still hit the 32-sweep cap; the tempered maximum exit residual grows to 0.008654 m/s. The next diagnostic isolates block, friction and neighboring-contact updates. The candidate remains unselected; no runtime or physical-accuracy gain is accepted from this screen.

The [exact block/friction trace](../benchmarks/experiments/glass-cached-block-trace-20260914-01/README.md) isolates a local coupling problem: 464,852 successful block updates leave normal residuals below 1.79e-10 m/s, but following friction updates produce errors up to 0.046234 m/s and cross the requested tolerance 49,276 times. Five complete observed/control states match exactly. A [fixed four-contact replay](../benchmarks/experiments/glass-coupled-patch-20260914-01/README.md) retains 1,028 independently reconstructed states; neither scalar nor normal-block iteration reaches 1e-6 m/s within 256 local sweeps from either captured or zero impulses. This identifies a reproducible pressure/friction convergence case for the next solver change. The full-model cap, installed backend and runtime claims remain unchanged.

The [coupled single-contact prototype](../benchmarks/experiments/glass-coupled-contact-20260914-02/README.md) passes seven mathematical/physical tests, including 3,000 manufactured systems and 800 body impacts with no kinetic-energy rise. All 2,048 local solves in the captured group meet 1e-10 m/s, yet both group histories still miss 1e-6 after 256 diagnostic sweeps. Four prior JSON histories match exactly; a retained signed-zero recording failure was corrected without changing the solver or physical tolerances, and all 1,542 raw/current observations reconcile. The next work addresses interactions across the whole contact group. This local solver remains experimental, with no production, runtime or roadmap qualification.

The [whole-contact-group prototype](../benchmarks/experiments/glass-contact-group-newton-20260914-01/README.md) passes nine focused tests and the full coupled 1e-6 m/s contact-law gate for the captured four-contact pair from both initializations: eight Newton updates from captured impulses and seven from zero. The prior scalar, normal-block and coupled-point histories all missed that tolerance after 256 sweeps. The direct SVD and analytic derivatives also pass manufactured, redundant-contact and rotated-basis checks; neither captured solve needs a fallback or increases its relative kinetic objective. These updates involve different work from scalar sweeps and establish no runtime ratio. The next experiment integrates atomic group updates and checks neighboring-contact interactions; production and roadmap counts remain unchanged.

The [integrated whole-group screen](../benchmarks/experiments/glass-cached-contact-group-20260914-02/README.md) passes 19 integration tests, fifteen exact original controls, three exact tight-scalar endpoints and 75 independent geometry samples. A retained 18/19 slider failure was corrected by tightening only local acceptance to 1e-10 m/s, preserving every physical gate. All fifteen cases pass motion, geometry and total-energy screens, but every group setting fails the practical accuracy/work gate: the tight variants still miss 1e-6 m/s and use up to 21.27 times original normal-row visits, with millions of additional SVD/gradient operations. Successful local roots do not establish global convergence. The next diagnostic captures an exact gradient-stalled group; no source or runtime improvement is selected.

The [group rescue/polishing screen](../benchmarks/experiments/glass-cached-contact-group-20260914-04/README.md) passes nineteen tests, fifteen exact original controls, three exact tight-scalar endpoints and seventy-five geometry checks. An [exact stalled-pair trace](../benchmarks/experiments/glass-group-fallback-trace-20260914-01/README.md) showed why the stricter local rule discarded a root already inside the global tolerance. Newton now runs only for unresolved groups, while resolved groups retain scalar polishing; the strict slider direction test passes. Delayed tight group residual evaluations fall 52.75–91.92% versus the stricter experimental version, across changed trajectories from the same initial fixtures. These counts establish no CPU/FPS gain. All physical screens pass, but dense contact networks still miss 1e-6 m/s and fail the unchanged practical energy/work gate. The next work captures a remaining local stall before changing the line search. Production v4 and roadmap counts remain unchanged.

## Geometry and response

Units are metres, seconds and kilograms. The standard pane has 364 triangular prisms; tempered glass has 1,058. Thickness is the selected millimetre value converted to metres. Each piece has area-derived mass and the full uniform-prism inertia tensor, including the triangle's product of inertia. Triangles overlapping the six grips remain fixed after fracture. This represents ideal holding over each complete triangle, without clamp compliance or slip.

The pendulum uses the rendered 235 mm sphere and the same offset arc as its rod. Its input drop height determines the actual bob-centre rise. The bob is a participant in the same contact solve as the shards, with one angular coordinate about the fixed pivot. Its inertia includes both the orbit and the solid sphere's own inertia. Contact-point velocity and effective mass use the pivot Jacobian, so normal and friction impulses act on the pendulum and fragments together. The visible sphere is tested analytically; its internal placeholder box is excluded from convex pair generation and geometric qualification.

The shard broad phase bounds translation and rotation. Narrow-phase separation tests all face normals and edge cross-products. Supporting face polygons are clipped into contact manifolds; edge contacts use their supporting features. The iterative impulse solve includes angular response, friction and restitution, with cached impulses and four temporal subdivisions. A coupled position solve retains separating planes while discovering neighbouring contacts.

The broad phase reuses its bound storage and body-order array, sorts exact numeric pair keys and returns owned pairs. Rotation and transformed-vertex calculations allocate their results directly, keeping the original arithmetic order. These changes remove temporary objects from repeated contact queries. Pair ordering, solver iterations and collision tolerances are preserved. Counts outside the exact integer pair-key range are rejected before allocating bounds.

Dense translation corrections now use reusable Float64 position and coefficient arrays with integer body offsets. Fewer than 64 planes, or fewer than half as many planes as bodies, use the scalar path to avoid packing unrelated bodies. Both paths preserve the original Gauss–Seidel order, relaxation, stopping threshold and 96-iteration limit. Copy-back preserves each body's owned position array, and every invocation overwrites the scratch it reads. Impulse accumulation updates only the current trial's cache, leaving the previous step available for adaptive retries.

Manifold clipping removes points coincident within 1e-10 metres on both shapes before reducing the support polygon. An edge touch retains its two distinct endpoints; a vertex touch retains one point; a face touch retains four. Supplied contact points receive the same duplicate check without mutating their provider's data. This removes redundant constraints without merging distinct sub-millimetre contacts.

Warm starts use body-pair buckets and one-to-one nearest local-anchor matching. A previous record can seed only one current constraint, each dynamic body's anchor must remain within 1 mm, the normal dot product must exceed 0.99, and the current gap must be within three contact skins. A change in either participant's dynamic/static status rejects its previous impulse. Accumulation and impact reporting remain per constraint. This replaces rounded 1 mm keys that could merge distinct contacts and then apply their combined impulse repeatedly. That cache revision kept the friction law, restitution, substeps and position tolerances unchanged. Persistent contact identity is also described in the [Box2D simulation documentation](https://box2d.org/documentation/md_simulation.html); this implementation uses bounded anchor matching rather than Box2D geometric feature IDs.

Tangential friction uses one scalar inverse trace of the contact's tangential effective inverse mass, followed by projection onto the same Coulomb disk. Separate diagonal tangent steps followed by circular projection produced a direction-dependent fixed point: rotating an otherwise identical free-slider scene changed its path by about 31 mm, even at 64 iterations. The revised update has the conditional maximum-dissipation fixed points and preserves the experiment under global yaw. It also removes four effective-mass calls per constructed contact whose results were overwritten before first use. Coefficients and iteration counts remain unchanged. See the [derivation and retained failures](../benchmarks/results/engine-100x/verification-glass-friction-20260911/friction-law.md).

Final translation correction retains support planes within three contact skins, including contacts whose current gap is acceptable. Previously the last pass could push a neighbor through a contact excluded by the penetration-only filter. Ordinary rigid bodies now also keep their orientations fixed during the final external position repair, matching the separating-plane solve. Full angular impulse response and temporal-substep pose correction remain active. The pendulum's generalized-coordinate overrides retain its pivot Jacobian and arc. This avoids alternating independent shard rotations with planes built for earlier orientations.

Contact skin is 10 micrometres and shard position slop is 20 micrometres; the bob's position correction targets the positive skin clearance. An unresolved rotating query or a trial with penetration above 0.2 mm is restored and retried as two half intervals. Excessive penetration permits five refinement levels; unresolved queries permit ten. Reaching a limit does not silently convert a failure to success: the returned statistics retain the actual residual and unresolved-query count. Qualification uses a separate 0.5 mm maximum penetration gate.

The exported convex sweep searches bounded rotational intervals and reports iteration exhaustion explicitly. The contact solver can use a cheaper conservative prediction when its rotational chord error is at most 0.1 mm. That prediction is not a precise time of impact. Tests distinguish the accurate query from the conservative solver prediction.

The sphere search uses a separating-plane closing-speed bound and bounds rotational acceleration over each candidate interval. This avoids a norm-only bound's slow convergence for grazing motion. Restitution retains the incoming speed across speculative braking, preventing the bounce from disappearing merely because contact falls between substeps. Fracture energy and the displayed impact count are separate authored model decisions.

The tray walls are finite. Pieces can clear a rim and fall to the room floor. The collision boxes follow fixture dimensions; bevels and decorative fasteners are not separately modelled.

## Runtime integration

Glass stepping runs in a module worker. The main thread renders transferred, owned frame arrays and keeps the controls and visual history. At most one batch of four 1/120-second ticks is in flight. Reset terminates the previous worker; stale results cannot replace a new specimen. A worker failure pauses the experiment and offers Reset. A pause can allow the already dispatched batch to finish.

Batch size now adapts between one and four ticks from the last observed request cost. A 40 ms target reduces expensive batches immediately and recovers gradually when work becomes cheaper. This is a delivery target: a single collision tick can exceed it. The accumulator subtracts exactly the number of requested fixed ticks; backpressure still permits only one outstanding request.

Live glass poses interpolate between received frames using linear positions and shortest-path quaternion rotations. The display follows received state without extrapolating; blend duration is capped at 150 ms. Pause, reset, replay selection, Live and completion snap to their authoritative endpoints. Stored frames, contact counters and solver state are not interpolated or mutated. Blended poses are a visual approximation and do not establish intermediate collision clearance. The intact pane uses its existing separate mesh; hidden fragment vertices and normals are updated only once fragments become visible, including after replay.

Worker isolation is a responsiveness improvement, not a reduction in solver CPU cost. Dense breakup may advance more slowly than wall time. Playback history contains visual frames and contact counters; it is not a complete resumable physical checkpoint. Floating-point time near 12 seconds is handled with a small completion tolerance so the experiment stops and can restart normally.

## Historical optimization studies before version-4 selection

The [SAT and pair-order study](../benchmarks/results/engine-100x/verification-glass-sat-study-20260911/README.md) retains five additional candidates. None is selected for the live solver. Its aggregate profile attributes about 21.8% of sampled CPU time to convex separation and 16.4% to candidate generation; instrumenting the latter identifies pair sorting as a substantial cost. These observations guide investigation and are not speedup claims.

The Float64 pair-storage candidate matches all 192 sampled version-2 physical states and independent geometry results across eight full presets. The later bitmap sorter passes 51 focused tests, strict kernel typechecking, 32 complete-state witnesses and 12 restored continuation ticks. It has not completed its own full preset matrix. A separately loaded unchanged solver exposed bias in the original timing setup. Subsequent isolated-process comparisons meet local dense-case gates but do not satisfy every intact-panel, tail and unchanged/sham control gate. All results and failed calibration attempts remain frozen; production CPU and FPS gains remain unqualified. At that checkpoint, contact tolerances and the version-2 solver were unchanged. Those study candidates remain unselected.

## Experimental force and collision improvements

The force-staged v4 candidate applies actual forces within each temporal substep and discovers new contacts along those substep trajectories. Prediction is rolled back before committed integration. This addresses contacts created by changing force-driven motion that an outer-step predictor can miss. The [original follow-up](../benchmarks/experiments/glass-force-staging-20260912-01/README.md) passes all eight full presets and records lower residual pile motion with no candidate energy rise in the matched settling window. These remain experimental results; the live backend above is still v3.

The [current optimization](../benchmarks/experiments/glass-ccd-witness-20260912-02/README.md) keeps that numerical behavior while removing cached-axis range tuples/closures, using exact numeric membership keys and reusing current separation proofs before final-position SAT. The proof includes a tie margin and falls back for nearby pairs, invalid hints, changed body counts or near-parallel edge axes. Skin, slop, friction, contact ordering and CCD budgets are unchanged. It removes a further 15.40% / 15.89% of vertex projections in the radial/tempered pile windows, including proof overhead; cumulative reductions from the original v4 are 52.39% / 58.02%. Construction counts are not actual heap bytes and these results do not establish a CPU or FPS gain.

The current candidate passes 64 focused tests, 2,040 complete model comparisons, 120 final-stage dense comparisons, 288 instrumented comparisons, 1,020 current-model integration comparisons, strict module TypeScript and the 24-case analytical friction matrix. The changed source also passes all 11,520 full-preset ticks and all 192 prior geometry/state samples exactly, with zero unresolved sweeps. The current integration snapshot preserves concurrent liquid terrain/configuration changes. The [isolated app preview](../benchmarks/experiments/glass-native-preview-20260912-01/README.md) passes WebGL controls, two views and both radial/thick-panel completion checks, but its radial endpoint differs from Node: 2,455 / 2,648 contacts and 756.02 / 757.031456 mm maximum out-of-plane motion. This needs browser geometry and runtime investigation; it does not itself prove a missed collision. Controlled timing, export and native WebGPU remain open. The owned preview is closed and no production glass source has been replaced.

## Verification contract

The subsequent [packed velocity study](../benchmarks/results/engine-100x/verification-glass-packed-velocity-20260911/README.md) remains experimental. It packs participating body velocities, inertia and contact coefficients into reusable Float64 arrays, retaining the original arithmetic and contact sweep order. Exact-prototype rigid and pendulum adapters preserve their impulse response; subclass or instance-method overrides use the scalar path. The revised caller checks small/sparse workloads before entering the packed method.

That source passes 55 focused tests, strict module TypeScript, 1,128 complete-tick deep comparisons, and all eight 12-second presets with all 192 sampled physical states matching version 3. Maximum accepted overlap is 0.200 mm, independent sampled overlap is 0.1725 mm, and unresolved sweeps are zero. The captured 2,739-contact JSON fixture also matches every serialized value; its JSON comparison does not preserve the sign of zero, unlike the fresh deep comparisons.

The fixed 24-group, 360-process timing campaign meets all candidate mean/tail/overhead thresholds, with dense throughput point estimates of 1.1306× and 1.1749×. Both dense unchanged-sham comparisons and all intact unchanged-control/sham comparisons fail their fixed calibration limits, so there is no qualified speed gain or installation. The first 180-process attempt, its intact overhead failure, and the superseded unrun qualifier remain retained. These exact-arithmetic changes do not improve settling convergence. The active contact kernel and pendulum are unchanged by this study; concurrent shared-file changes for the liquid study are recorded separately. No new browser, native WebGPU or current-app integration qualification is claimed.

| Requirement | Check | Evidence and scope |
| --- | --- | --- |
| Every return swing contacts intact glass | 12-second central and offset thick panes at two outer time steps; check sphere clearance on every frame | `tests/studio/material-collision.test.mjs` |
| Collider geometry matches visible geometry | Independent Three.js matrix transforms of every shard vertex and shared fixture dimensions | Same test file |
| Thin and rotating collisions are found | Analytic translation through 2 mm walls, 10–1,000 m/s, three axes and two directions; a full-turn rotating sweep with disjoint endpoints | `tests/engine/convex-contact.test.mjs` |
| Reused broad-phase storage preserves results | Independent all-pairs enumeration through growth, disabled bodies, body reordering, touching bounds and repeated queries; returned pairs remain owned | Same test file |
| Contact response includes mass and rotation | Independent inertia quadrature, isolated momentum/energy checks, friction/resting contact and finite-rim tests | Same test file; isolated examples are not global energy conservation |
| Packed and sparse position correction preserve physical invariants | Mass-weighted centres, fixed supports, separation, untouched bodies and owned arrays through growth and reuse | Same test file |
| Distinct contacts cannot reuse one cached impulse | Analytic edge/vertex/face supports, sub-millimetre contacts, reversed ordering, invalid anchors/normals, and held/free transitions | Eight regressions in `tests/engine/contact-cache.test.mjs`; the old alias and unguarded transitions are reproduced in retained experiments |
| Historical fixed-orientation friction reference | Fixed-orientation slider, analytical stopping distance/time, impulse balance, Coulomb bound and halved steps | `glass-contact-cache-20260911-03/friction-reference-result.json`; first-order distance convergence, not a free-fragment or pile calibration |
| Free sliding is independent of the world tangent basis | Global yaw, time/iteration refinement, analytical distance/direction, impulse balance and Coulomb bound | Three regressions in `tests/engine/friction-covariance.test.mjs`; 24 final-source cases match the corrected reference |
| Position correction retains support and consistent coordinates | Every accepted interval of radial breakup; off-centre mass-weighted rigid translation; independent pendulum Jacobian/arc | `tests/studio/glass-contact-support.test.mjs` and `tests/engine/contact-projection.test.mjs`; both captured full-model failures pass |
| Worker state is owned and bounded | Direct-model equivalence, transfer detachment, stale/reset requests, backpressure and errors | `tests/studio/glass-worker.test.mjs` |
| Pendulum and retained glass act together | Fixed-pivot angular momentum, analytic sphere/plane contact angle, coupled support and independently checked retained-fragment clearance | `tests/studio/glass-pendulum.test.mjs` |
| Reference audit is independent of production poses/SAT | Analytic rotated-box gaps and dynamic/static pair filtering | `tests/qualification/glass-reference.test.mjs` |
| Full preset matrix | All eight presets for 1,440 ticks each, finite state and clamp invariants every tick; independent geometry audit every 60 ticks | All 8 version-3 cases pass in `glass-friction-20260911-03`; 11,520 ticks and 192 independent sample times |
| Live controls and rendering | Completion, breakup, replay/Live, active pause/reset and two views | Version-3 radial and thick-panel runs, overview/top, pause, replay/Live and reset pass on local WebGL fallback; see `verification-glass-friction-20260911/browser-receipt.json`. Native WebGPU remains unqualified for this revision. |
| Integrated production build | Not run in this continuation | TypeScript and Vite development checks do not establish a production build |

Run the focused checks with:

```sh
node --test --test-concurrency=1 tests/engine/convex-contact.test.mjs tests/engine/contact-cache.test.mjs tests/engine/friction-covariance.test.mjs tests/engine/contact-projection.test.mjs tests/studio/glass-contact-support.test.mjs tests/studio/material-collision.test.mjs tests/studio/glass-worker.test.mjs tests/studio/glass-pendulum.test.mjs tests/studio/glass-presentation.test.mjs tests/qualification/glass-reference.test.mjs
npm run typecheck
```

Create a fresh, exclusive qualification directory with:

```sh
node scripts/glass-collision-qualify.mjs UNIQUE-RUN-ID
```

The run freezes and hashes its source and protocol before executing. The independent audit rebuilds vertices with Three.js, derives face and edge axes from mesh topology, and checks every overlapping dynamic/static or dynamic/dynamic AABB pair. A separate Three.js triangle-distance and containment calculation checks the analytic bob against all actual colliders. These checks do not call the production broad phase, transformed poses, SAT or sphere-distance routine. Per-tick accepted residuals and half-second independent samples are distinct evidence; neither is a continuous proof of all possible trajectories. State hashes include the pendulum but are not a checkpoint-replay qualification. Protocol version 2 adds the independent sphere audit; retained-glass cases run first so their failure cannot be hidden behind a completed free-breakup case.

The frozen numerical sources are sufficient to repeat the numerical experiment. Companion renderer and controller hashes identify their versions; this is not a standalone application bundle. In particular, unrelated shared UI dependencies can continue changing in this checkout. The browser receipt identifies the live version inspected.

The accuracy result requires finite state, unchanged clamped transforms, all 1,440 ticks, both penetration maxima at or below 0.5 mm, and no unresolved sweep queries. Individual CPU timings are observations without unchanged controls or rendering; `performanceQualified` remains false. Failed attempts and their frozen inputs must remain intact.

`node scripts/glass-collision-check.mjs RUN-DIRECTORY` rehashes frozen sources and recomputes the stored acceptance gates. It verifies sample-hash structure and agreement between case and aggregate results, without claiming to replay the sampled geometry.

## Version-3 qualification

[The version-3 run](../benchmarks/results/engine-100x/runs/glass-friction-20260911-03/result.json) passes all eight presets over 11,520 ticks and 192 independent sample times. Maximum accepted overlap is 0.200 mm and the independent samples reach 0.1725 mm, with finite state, unchanged clamped transforms and zero unresolved sweeps. The 0.5 mm gate and solver iteration limits are unchanged. Trajectories differ from version 2; this is a new physical qualification.

The integrated source passes 51 focused tests and the full root TypeScript check. The free-slider stopping-distance errors at four iterations are 5.076, 2.537 and 1.270 mm as the outer step halves from 1/120 to 1/480 second. Globally rotated copies agree to within 1.6e-15 metres across the recorded default and refined cases. At 64 iterations, friction opposes sliding, obeys the Coulomb bound and has no measured kinetic-energy increase beyond rounding. Four-iteration settling retains small residuals: reaching a strict 1e-8 m/s speed takes 0.3333, 0.2875 and 0.2646 seconds, against an analytical 0.2489 seconds. These converge with refinement; they do not establish general pile frictional-work convergence.

The two captured collision failures now satisfy the unchanged gate. The late laminated-glass input goes from 1.180 mm maximum accepted overlap and 15 subdivision retries in the preceding experimental candidate to 0.136 mm and no retries. The radial input stays at 0.022 mm. A four-contact instrumented step removes 16 of 120 effective-mass calls. These are bounded correctness and operation-count results; a controlled whole-solver CPU or frame-rate gain is not established. The [verification packet](../benchmarks/results/engine-100x/verification-glass-friction-20260911/README.md) retains all failed candidates, complete failing inputs and the selected source.

The live WebGL preview completed both the radial and thick-panel presets. Released shards settled in the tray; two views, active pause, replay/Live and reset were checked. No console warnings or errors were captured. The task-owned tab was closed after inspection. This is a local renderer/control check, not native-WebGPU or device-performance qualification.

## Resting motion and contact convergence

The [resting-contact study](../benchmarks/results/engine-100x/verification-glass-convergence-20260911/README.md) reproduces all 24 radial physical sample hashes. At twelve seconds, 338 bodies share a connected loaded-contact group. The median centre speed is 0.03859 m/s and the median maximum vertex speed is 0.08853 m/s. The conservative surface-speed bound has median 0.12742 m/s; it must not be presented as exact vertex motion. Only seven fragments belong to whole groups below 0.020 m/s even instantaneously. Completion of the timed program and visually remaining in the tray do not establish physical rest.

From the same complete late input, requesting 64 instead of four scalar iterations reduces mean normal residual 17.65-fold over half a second. A two-to-four-contact block candidate improves an analytical support case and passes 35 corrected-source checks, but it does not justify fewer global iterations: two candidate iterations have greater normal and friction residuals than four scalar iterations. Four candidate iterations reduce mean normal residual 19.24% but increase median final motion. No new production solver, sleeping rule, full-preset/browser qualification or controlled speed gain is selected. The remaining problem includes convergence across the large contact group.

The subsequent [global-solve study](../benchmarks/results/engine-100x/verification-glass-global-solve-20260911/README.md) retains 23 fixed cases for normal over-relaxation, warm-start line search and support-graph ordering. None meets the accuracy, motion and transient-energy screening limits at four or fewer requested iterations. At eight iterations, warm-start and support candidates pass the scalar-four screen, but neither establishes an improvement at the same work budget. Production stays unchanged.

Three energy traces separate force kicks, cached impulses, normal/friction work and pose correction. In the first 0.1 s of the original late-pile state, warm starting adds 25.37 J of kinetic energy and final projection raises fragment potential energy by 6.65 J, with substantial opposing changes from velocity response and motion integration. These are internal transfers, not net energy gains. The baseline's transient net mechanical rise peaks at 0.135 J during the half-second observation; final mechanical energy is lower than initial. The accounting closes within 1e-10 J and each complete instrumented result matches the original. These diagnostics do not by themselves identify a single cause of stickiness or prove general energy conservation.

A new 2,739-contact captured system supports a prepared-Jacobian reference for the existing ordered scalar solve. Four iterations reproduce linear velocity within 1.67e-16 m/s, angular velocity within 7.99e-15 rad/s and impulses within 2.78e-17 N·s. Its 394 bodies include no active pendulum contact in this capture. Reusable packed storage, integrated accuracy checks and controlled whole-step performance remain pending; no optimized backend is selected from this algebra check.

## Force staging and contact discovery candidate

The [force-staging checkpoint](../benchmarks/results/engine-100x/verification-glass-force-staging-20260911/README.md) moves force application into temporal substeps and discovers newly encountered swept contacts after each velocity solve. It includes a retained rotating-obstacle miss from the first force predictor and the rejected whole-trial retry variants.

In the fixed half-second pile screen, the one-iteration candidate reduces mean normal residual 64.22%, median actual vertex motion 81.92% and p95 motion 70.25% against v3 at four iterations, with no mechanical energy rise, no unresolved CCD and 22.43 micrometres maximum overlap. Actual scalar sweeps fall from 976 to 627, with additional discovery work. The final candidate passes 64 focused tests. The [September 12 follow-up](../benchmarks/experiments/glass-force-staging-20260912-01/README.md) also passes all eight full presets over 11,520 ticks and 192 independent samples, with zero unresolved CCD, 0.199942 mm maximum accepted penetration and 0.197429 mm maximum independently sampled penetration. Sixty full explicit/default model comparisons and 1,020 current-app model comparisons pass, including the stored half-second endpoint. Strict model-dependency TypeScript passes.

The actual one-iteration default has Coulomb stopping-distance errors of 1.276, 0.638 and 0.318 mm as the outer step halves; finite stopping-time and friction-direction errors remain. A three-second continuation from the same full pile state reduces median vertex motion 81.62%, p95 motion 72.20% and final kinetic energy 69.93%. No candidate case rises above its initial mechanical energy, while the v3 continuation rises by up to 0.134963 J. The first report incorrectly included that baseline failure in the candidate gate; its raw result is retained and the corrected evaluator changes no numerical data or thresholds.

Profiling shows geometry projection and interval ranges account for about 34% of sampled self time, with substantial additional swept-query work. At this historical checkpoint the installed backend was v3. Version 4 is now selected following the native checks above; controlled CPU/FPS qualification, much longer settling and full-trajectory convergence remain open.

The [separating-axis cache experiment](../benchmarks/experiments/glass-ccd-witness-20260912-01/README.md) reduces SAT/sweep vertex projections by 43.72% in a radial pile and 50.09% in a tempered pile, including the new check's projection overhead. It stores bounded shape-axis indices and reprojects current/end geometry before certifying a miss; inconclusive checks retain the ordered search and exhaustion behavior. It preserves 2,160 complete model state/statistic comparisons, 288 instrumented comparisons and 11,814 query/lifecycle comparisons. All 64 focused tests, strict model TypeScript and the 24 prior analytical-slider outputs pass. The packet retains a failed audit that incorrectly included the pendulum's disabled box proxy, plus its full-state reproduction and corrected analytical-sphere audit. The changed candidate passes all eight full presets over 11,520 ticks, with all 192 recorded geometry/state samples exactly matching the preceding qualified candidate and no unresolved CCD. Maximum checked penetration remains below 0.2 mm. A 32-process unchanged-source pilot fails one fixed timing-control interval, independently confirmed; controlled speed and native selection checks remain pending, and production glass is unchanged.

## Residual-history contact study

The [residual-history investigation](../benchmarks/results/engine-100x/verification-glass-residual-history-20260911/README.md) retains 67 captured-system cases and 19 half-second full-model cases. Short QR-based histories improve contact convergence, but every tested candidate at four or fewer iterations fails the complete motion/energy screen. The strongest four-iteration candidate reduces mean normal residual 28.10% while increasing median vertex speed 0.94% and p95 vertex speed 3.70%; transient mechanical energy rises 0.07294 J. Lower contact error alone does not establish less sticky or settled glass.

At eight iterations, the same candidate reduces normal residual 53.66%, friction residual 40.33%, median actual maximum vertex speed 29.86% and p95 vertex speed 24.33% against the original eight-iteration solve. It passes the retained half-second mathematical screen, with no mechanical rise above the initial energy and maximum accepted overlap 0.04994 mm. Additional extrapolation work is included, so matching iteration counts does not establish matching CPU cost or a speedup.

The final experimental source passes twelve focused checks and strict kernel/helper/pendulum TypeScript. Across the three integrations, instrumentation preserves 1,140 complete tick states and disabled candidates preserve 600 frozen-v3 tick states. An analytical restitution case motivates measuring proposed contact work from the pre-warm-start state: passive rebound can recover dissipation from an intermediate iterate. The full-trajectory energy limit stays unchanged. Earlier incremental-work guards and failed variants are retained. The live v3 source remains unchanged; full-preset/current-app checks, controlled runtime, default settling and physical calibration remain open.

## Version-3 SAT cost study

The [scalar SAT study](../benchmarks/results/engine-100x/verification-glass-sat-scalar-20260911/README.md) profiles the current backend through tick 252: SAT accounts for 21.22% of sampled time, candidate-pair generation 14.14%, and garbage collection 7.62%. An experimental scalar edge-axis rewrite preserves 16,384 query results, 19 complete-state witnesses and restored tails, and passes 51 focused tests plus strict kernel TypeScript.

Its fixed-path, single-workload comparison completes 60 fresh processes with matching recorded states. Dense throughput is 0.9966× (95% interval 0.9702–1.0237×); the required speed lower bound and tail gate fail. Intact overhead and unchanged/sham calibration also fail. This is not evidence of a reliable speed gain, and the candidate is not selected. The installed version-3 source stays unchanged; the candidate's full eight-preset and browser qualification were not run. The raw profile, controls, complete fixtures and failed decision are retained without changing thresholds.

## Version-2 qualification

[The version-2 run](../benchmarks/results/engine-100x/runs/glass-cache-20260911-03/result.json) passes all eight presets over 11,520 ticks and 192 independent sample times. Maximum accepted overlap is 0.311 mm; the independent samples reach 0.199 mm. Every case has finite state, unchanged clamped transforms and zero unresolved sweeps. These remain within the unchanged 0.5 mm gate; peak overlap is not an improvement over version 1. Contact identity changes physical trajectories, so equivalence with version 1 is not claimed.

The [cache integrity review](../benchmarks/experiments/glass-contact-cache-20260911-03/integrity-review.json) checks 20 frozen source/test files, 45 passing focused tests, the old duplicate-impulse reproduction, two failing transition tests in the unguarded candidate, and all stored numerical gates. The controlled slider matches the preceding backend: stopping-distance errors are 4.124, 2.081 and 1.040 mm at 1/120, 1/240 and 1/480 second steps, reducing by factors 1.982 and 2.000. It shows no kinetic-energy gain and a maximum horizontal impulse/momentum residual below 5.6e-17 N·s. Its orientation is constrained, so it does not establish frictional-work convergence for rotating fragment piles. See the [version-2 packet](../benchmarks/results/engine-100x/verification-glass-cache-20260911/README.md).

Removing duplicate supports reduces the number of constraints in degenerate manifolds. This has not established a controlled whole-solver CPU or FPS improvement. Dense breakup remains expensive, and all previous rejected timing trials are retained.

The live WebGPU check completed the radial preset with released fragments in the tray and glass remaining at the ideal clamps. Overview/top views and replay/Live worked; tempered breakup and pause were also inspected. A later document reset coincided with a concurrent Metal press source edit and selected WebGL. No console error was captured, and the glass source hashes were unchanged. The source edit is a plausible development-reload cause, not a proven diagnosis of the refresh or renderer fallback. Remaining control checks continued on the fallback renderer; this is not an uninterrupted native-WebGPU acceptance of every action.

## Preceding version-1 qualification

[The preceding run](../benchmarks/results/engine-100x/runs/glass-collision-20260911-05/result.json) passed all eight presets. Its maximum accepted overlap was 0.207 mm; the independent samples reached 0.194 mm. Every case had zero unresolved sweeps and unchanged clamped transforms. The [integrity audit](../benchmarks/results/engine-100x/runs/glass-collision-20260911-05/integrity-review.json) verifies 17 frozen sources and all stored gates. The [equivalence audit](../benchmarks/results/engine-100x/runs/glass-collision-20260911-05/equivalence-review.json) matches all 192 sampled physical states, independent geometry samples and per-case physical summaries against the preceding `glass-collision-20260911-04` run. Hidden caches and unsampled states are not directly compared. These equivalence and timing results do not qualify version 2.

The [correction-loop packet](../benchmarks/results/engine-100x/verification-glass-contact-hotpath-20260911/README.md) records 29 passing focused tests, TypeScript, controlled projection timings and deliberately altered timing records. The [preceding allocation packet](../benchmarks/results/engine-100x/verification-glass-contact-optimization-20260911/README.md) preserves the earlier optimization and its development-worker check. The [original contact packet](../benchmarks/results/engine-100x/verification-glass-contact-20260911/README.md) preserves the initial collision implementation, its failed approaches and earlier rendering/control evidence.

| Preset | Max accepted overlap, mm | Max independent sampled overlap, mm | Node step elapsed seconds per 12 simulated seconds |
| --- | ---: | ---: | ---: |
| radial-impact | 0.199 | 0.194 | 62.98 |
| tempered-dice | 0.199 | 0.130 | 268.80 |
| laminated-retention | 0.200 | 0.162 | 69.76 |
| thick-panel | 0.000 | 0.000 | 0.93 |
| edge-strike | 0.200 | 0.177 | 82.34 |
| frosted-fracture | 0.200 | 0.116 | 59.93 |
| wired-retention | 0.207 | 0.171 | 52.72 |
| acrylic-comparison | 0.000 | 0.000 | 0.90 |

These are single-run step-time observations. Dense breakup did not meet a real-time budget, and no controlled whole-solver or renderer-inclusive gain is established. The production build and physical-device matrix remain unrun in this continuation.

## Isolated correction-loop timing

The [controlled comparison](../benchmarks/experiments/glass-contact-hotpath-20260911/projection-measured-02/result.json) replays three actual radial-breakup projection inputs, each with 394 bodies. Six independent Node processes run serially with balanced reference/candidate/unchanged-control order, 12 warm-up rounds and 24 measured rounds of 32 calls per sample. Every measured output matches the reference bit for bit. Timed calls include identical position restoration and the candidate's packing and copy-back; discovery, impulse response, workers and rendering are outside this measurement.

| Captured outer tick | Planes | Geometric mean of process median-time ratios | 95% process-level interval |
| --- | ---: | ---: | --- |
| 240 | 646 | 1.213× | 1.190–1.235× |
| 480 | 634 | 1.218× | 1.200–1.236× |
| 600 | 616 | 1.212× | 1.188–1.237× |

All unchanged controls and predeclared timing gates pass. Sparse and two-body cases do not show a relative speedup: their maximum added median cost is 0.306 and 1.518 microseconds, respectively; maximum added p95 cost is 1.051 and 2.439 microseconds. These pass the predeclared 5-microsecond median and 10-microsecond p95 overhead limits. This is a bounded dense-kernel improvement, not a whole-engine speedup.

The first packed-only candidate and its [failed overall comparison](../benchmarks/experiments/glass-contact-hotpath-20260911/projection-measured-01/result.json) remain intact. It incurred avoidable sparse packing cost and failed one unchanged-control envelope. The revised candidate uses the scalar fallback, with the same benchmark inputs and gates. An independent Python audit recomputes the intervals and rejects altered state hashes, source hashes, speedup figures and thresholds.

## Glass release and responsiveness

The September 11 release investigation reproduced plain annealed fragments falling into the tray, with fragments at the six clamps remaining held. A regression fixture presses a body against a wall, removes its normal load and checks that the cached friction releases without attraction. Laminated and wired retention remain intentional authored material behavior.

The preceding release pass changed presentation, request cadence and hidden geometry updates. In that pass, the collision kernel, model, material catalog, pendulum and fixture source matched the pre-investigation baseline exactly; the later version-2 contact fix changes the collision kernel only. Two separately frozen CPU candidates were evaluated and rejected: the SAT allocation rewrite measured 0.9355× whole-step throughput, and the scalar mass/impulse rewrite measured 1.0013× without passing qualification. Both preserve the 36 checked fracture/dense-tray/settling state transitions; neither is selected for production.

Each timing experiment uses six serial processes, balanced role positions, three restored complete-model states and 648 measured one-tick samples. Restoration, state hashing, transport and rendering are excluded from these timings. The raw records, independent gate recalculation and failed trials remain in `benchmarks/experiments/glass-release-20260911-01` through `-05`. Reduced delivery delay and skipped invisible mesh work are separate from a solver CPU or frame-rate gain; no new qualified speed multiplier is claimed.

That release source passed 37 focused tests and TypeScript, including response-cost batching, variable-batch/direct-model equivalence, quaternion wrapping, display/history ownership, exact pause/reset behavior and contact-load removal. The full eight-preset qualification was not rerun in that pass; it has now been rerun for version 2. The historical solver source and qualification remain intact. The [release packet](../benchmarks/results/engine-100x/verification-glass-release-20260911/README.md) records that pass's source, raw test logs, browser observations and independent timing audits.

## Remaining limits and recovery

The current method is approximate for anisotropic torque-free rotation and large coupled contact networks. Position projection can alter angular energy through orientation. No calibrated fracture energy, crack-tip stress, interlayer constitutive law, broad seed/control coverage, physical-device performance or whole-engine speedup is established. Collision accuracy, fracture realism and interactive speed are separate acceptance targets.

Use Reset to discard the current specimen and worker; reload the loopback preview if initialization fails. Preserve the shared dirty checkout and frozen runs when changing code. Do not use a repository-wide reset as rollback. A superseding collision implementation needs a new source-frozen run rather than editing accepted or failed historical receipts.

The approach follows the separation between predictive contact generation and contact response described in Erin Catto's [continuous collision presentation](https://box2d.org/files/ErinCatto_ContinuousCollision_GDC2013.pdf) and [contact manifold presentation](https://box2d.org/files/ErinCatto_ContactManifolds_GDC2007.pdf). These references explain the techniques; they are not validation of this implementation.
