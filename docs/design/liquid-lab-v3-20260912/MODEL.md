# Liquid Lab V3 model

The first-order finite-volume shallow-water model uses a shared face flux and side-specific hydrostatic pressure corrections over a common rendered/solved bed. This follows the hydrostatic reconstruction described in [Audusse et al., 2004, equations 2.8–2.11](https://publications.imp.fu-berlin.de/478/1/file_2004_siam.pdf). The implementation is an application-specific two-dimensional extension with a Rusanov flux, adaptive CFL substeps, authored drag and viscosity damping. It is not a validated implementation of every result in that paper.

The bed is sampled on an 84 × 28 grid over a 6 × 2 metre apparatus. Flat, crowned, guttered, hollow, ridged and stepped beds share their elevation function with the scene. Riverbanks are bed elevations; only the two boulders remain impermeable obstacle cells. Initially dry banks can flood. Bank height, channel width and meander affect both geometry and hydraulics.

Volume = initial + supplied + rain − collected − rim overflow − infiltration. The displayed “Collected + overflow” combines the two external discharge paths. Only boundary cells can spill over a finite rim; there is no interior height clamp. Rain uses horizontal exposed area. Absorption is a comparative constant bed rate reduced by viscosity.

Pump delivery is demand-limited by a Darcy-style resistance calculation with adjustable head, bore, line length, authored attachment losses and a valve-loss surrogate. Constant, gradual, pulsed and surge programs scale actual sources. The same six attachment outlet locations drive inlet cells and scene jets. Pipe pressure waves, cavitation and a connected pressure-network solution are not modelled.

Depth and speed inspection colors read recorded depth and velocity arrays. Their fixed scales are 0–1 m for flumes, 0–0.5 m for rivers, 0–0.25 m for pipes, 0–50 mm for surface/rain studies, and 0–2 m/s for speed. The upper legend endpoint includes larger values. Switching appearance does not reset a run. Jets, surface streaks and impact rings illustrate recorded input and motion; individual droplets are not solved.

The 24 named fluids use authored constant-viscosity factors and relative density. Gel, shampoo, paint and slurry are homogeneous surrogates; yield stress, shear thinning, curing, thermal changes, sediment transport and erosion are excluded. The depth-averaged approximation cannot resolve overturning, droplets, capillary/contact-angle effects, or details smaller than the grid. Thin films on abrupt bed steps are resolution-limited. Surface resistance is liquid-flow resistance, not measured shoe friction or a slip-safety rating.

Verification covers stationary water with dry shorelines, floodable banks, shaped-bed pooling, rainfall volume, program integrals, visible/source outlet agreement, rim overflow, cutoff/replay, full preset runs and saved-setting compatibility. Browser appearance and numerical verification are separate gates.
