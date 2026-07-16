# WebPhysics v1.13 shard 2/10

Generated: 2026-07-16T21:02:47.307Z

Cases: **100**; group: **native-actions-sync**; smoke: **false**.

Registry: `ac38d476ee69c222ce9fb7380d9d53eb30b101e0dd34a1e13be9334fe0c9c032`

Candidate source: `9baae5ee1004276a5937b66a1eae13f3c2776f3d198edd2a5637f231b1286cbe`

Harness closure: `6b54d5e2a7bc71d086b860c9384dd36d5951630399faeeb21a7c093072c5fcb9`

| ID | Scene | Protocol | Speedup | 95% CI | Min batch | Correct | Decision |
|---:|---|---|---:|---:|---:|---|---|
| 101 | Pyramid Settling Stack — Baseline | active-step-sync | 0.9904× | 0.977–1.012 | 1916.55 ms | yes | control |
| 102 | Mega Stack Collapse — High Stress | explicit-sync | 0.9825× | 0.974–0.989 | 37.08 ms | yes | control |
| 103 | Column Forest Compression — High Stress | native-mixed-actions | 1.0109× | 0.978–1.057 | 507.13 ms | yes | borderline |
| 104 | Cantilever Block Shelf — Precision | native-step-explicit-sync | 1.0079× | 0.990–1.028 | 1939.42 ms | yes | control |
| 105 | Offset Brick Tower — Impact Demo | active-step-sync | 0.9951× | 0.955–1.037 | 1915.53 ms | yes | control |
| 106 | Stair-Step Avalanche — Impact Demo | explicit-sync | 0.9926× | 0.984–0.998 | 40.01 ms | yes | control |
| 107 | Warehouse Pallet Pile — Cinematic | native-mixed-actions | 0.9926× | 0.974–1.011 | 462.41 ms | yes | borderline |
| 108 | Double Helix Dominoes — Baseline | native-step-explicit-sync | 1.0006× | 0.984–1.041 | 35.01 ms | yes | control |
| 109 | Thin-Body Stability Trial — Baseline | active-step-sync | 1.0076× | 0.993–1.018 | 32.82 ms | yes | control |
| 110 | S-Curve Cascade — High Stress | explicit-sync | 0.9664× | 0.957–0.973 | 19.68 ms | yes | control |
| 111 | Domino Ramp Relay — Precision | native-mixed-actions | 0.9833× | 0.968–1.004 | 37.67 ms | yes | borderline |
| 112 | Domino Cathedral — Impact Demo | native-step-explicit-sync | 0.9962× | 0.973–1.007 | 47.84 ms | yes | control |
| 113 | Domino Gate Array — Impact Demo | active-step-sync | 0.9981× | 0.985–1.002 | 44.47 ms | yes | control |
| 114 | Concentric Contact Rings — Cinematic | explicit-sync | 0.9965× | 0.984–1.007 | 21.56 ms | yes | control |
| 115 | Core-and-Shell Tower — Baseline | native-mixed-actions | 1.0012× | 0.985–1.019 | 58.52 ms | yes | borderline |
| 116 | Stacked Module High Rise — Baseline | native-step-explicit-sync | 1.0005× | 0.993–1.012 | 268.20 ms | yes | control |
| 117 | Podium Tower Collapse — High Stress | active-step-sync | 0.9968× | 0.987–1.006 | 447.79 ms | yes | control |
| 118 | Twin Tower Collision Test — Precision | explicit-sync | 0.9940× | 0.968–1.025 | 31.62 ms | yes | control |
| 119 | Needle Spire Shake Test — Precision | native-mixed-actions | 0.9934× | 0.979–1.008 | 56.75 ms | yes | borderline |
| 120 | Diagonal Tube Frame — Impact Demo | native-step-explicit-sync | 0.9990× | 0.993–1.008 | 342.79 ms | yes | control |
| 121 | Mega-Braced High Rise — Cinematic | active-step-sync | 1.0007× | 0.990–1.009 | 470.93 ms | yes | control |
| 122 | Bridge Load Test — Baseline | explicit-sync | 0.9807× | 0.968–1.007 | 14.20 ms | yes | control |
| 123 | Cantilever Span Stress — Baseline | native-mixed-actions | 0.9983× | 0.964–1.021 | 38.46 ms | yes | borderline |
| 124 | Drawbridge Drop Test — High Stress | native-step-explicit-sync | 0.9905× | 0.984–1.000 | 58.46 ms | yes | control |
| 125 | Suspension Deck Proxy — Precision | active-step-sync | 1.0148× | 0.994–1.045 | 50.88 ms | yes | control |
| 126 | Covered Bridge Debris Test — Precision | explicit-sync | 0.9792× | 0.967–0.990 | 15.39 ms | yes | control |
| 127 | Rail Trestle Vibration — Impact Demo | native-mixed-actions | 1.0056× | 0.969–1.030 | 37.20 ms | yes | borderline |
| 128 | Truss Span Failure — Cinematic | native-step-explicit-sync | 0.9992× | 0.985–1.014 | 53.46 ms | yes | control |
| 129 | Multi-Pier Viaduct — Cinematic | active-step-sync | 0.9906× | 0.975–1.014 | 54.51 ms | yes | control |
| 130 | Bumper Rail Test — Baseline | explicit-sync | 0.9902× | 0.961–1.009 | 12.75 ms | yes | control |
| 131 | Restitution Staircase — High Stress | native-mixed-actions | 0.9991× | 0.979–1.022 | 30.92 ms | yes | borderline |
| 132 | Material Bounce Lab — Precision | native-step-explicit-sync | 1.0110× | 0.987–1.025 | 43.42 ms | yes | control |
| 133 | Floor Coating Comparison — Precision | active-step-sync | 0.9990× | 0.990–1.016 | 44.78 ms | yes | control |
| 134 | Heavy-Light Collision Matrix — Impact Demo | explicit-sync | 1.0022× | 0.961–1.029 | 11.56 ms | yes | control |
| 135 | Ice vs Rubber Lanes — Cinematic | native-mixed-actions | 1.0057× | 0.974–1.022 | 31.26 ms | yes | borderline |
| 136 | Sliding Crate Gauntlet — Cinematic | native-step-explicit-sync | 0.9958× | 0.980–1.008 | 47.05 ms | yes | control |
| 137 | High-Altitude Drop Test — Baseline | active-step-sync | 1.0001× | 0.984–1.017 | 615.05 ms | yes | control |
| 138 | Debris Storm Chamber — High Stress | explicit-sync | 0.9895× | 0.983–1.002 | 34.81 ms | yes | control |
| 139 | Dense Core Rain Column — High Stress | native-mixed-actions | 0.9982× | 0.991–1.004 | 70.80 ms | yes | borderline |
| 140 | GPU Upload Saturation — Precision | native-step-explicit-sync | 1.0056× | 0.995–1.013 | 623.25 ms | yes | control |
| 141 | Falling Cargo Bay — Impact Demo | active-step-sync | 0.9801× | 0.966–1.016 | 646.71 ms | yes | control |
| 142 | Object Rain Stress Test — Cinematic | explicit-sync | 0.9990× | 0.986–1.008 | 36.31 ms | yes | control |
| 143 | Randomized Settling Cloud — Cinematic | native-mixed-actions | 1.0130× | 1.000–1.035 | 58.71 ms | yes | borderline |
| 144 | Falling Chimney Test — Baseline | native-step-explicit-sync | 1.0084× | 0.956–1.032 | 2552.23 ms | yes | control |
| 145 | Block House Demolition — High Stress | active-step-sync | 1.0080× | 0.989–1.027 | 2736.15 ms | yes | control |
| 146 | Stacked Barricade Assault — High Stress | explicit-sync | 0.9944× | 0.980–1.002 | 35.44 ms | yes | control |
| 147 | Barrier Breach Range — Precision | native-mixed-actions | 1.0054× | 0.989–1.038 | 504.56 ms | yes | borderline |
| 148 | Rubble Wall Breach — Impact Demo | native-step-explicit-sync | 0.9986× | 0.981–1.011 | 2183.25 ms | yes | control |
| 149 | Progressive Collapse Theater — Impact Demo | active-step-sync | 1.0041× | 0.963–1.022 | 1951.97 ms | yes | control |
| 150 | Wrecking Ball Proxy — Cinematic | explicit-sync | 0.9853× | 0.975–1.000 | 37.27 ms | yes | control |
| 151 | Train Car Coupler Proxy — Baseline | native-mixed-actions | 0.9934× | 0.976–1.003 | 32.71 ms | yes | borderline |
| 152 | Vehicle Obstacle Course — High Stress | native-step-explicit-sync | 0.9889× | 0.982–1.002 | 43.26 ms | yes | control |
| 153 | Bulldozer Blade Proxy — High Stress | active-step-sync | 0.9936× | 0.978–1.009 | 44.88 ms | yes | control |
| 154 | Rolling Crate Convoy — Precision | explicit-sync | 0.9925× | 0.975–1.000 | 13.63 ms | yes | control |
| 155 | Truck Cargo Spill — Impact Demo | native-mixed-actions | 0.9907× | 0.962–1.020 | 30.58 ms | yes | borderline |
| 156 | Container Yard Collision — Impact Demo | native-step-explicit-sync | 0.9897× | 0.974–1.004 | 50.68 ms | yes | control |
| 157 | Crash Barrier Test — Cinematic | active-step-sync | 0.9913× | 0.980–1.009 | 55.53 ms | yes | control |
| 158 | Sluice Gate Sorter — Baseline | explicit-sync | 1.0332× | 1.012–1.054 | 30.94 ms | yes | control |
| 159 | Physics Toy Museum — Baseline | native-mixed-actions | 0.9913× | 0.987–0.997 | 40.21 ms | yes | borderline |
| 160 | Obstacle Peg Board — High Stress | native-step-explicit-sync | 1.0027× | 0.976–1.012 | 117.75 ms | yes | control |
| 161 | Funnel Drop Maze — Precision | active-step-sync | 0.9912× | 0.984–1.000 | 101.45 ms | yes | control |
| 162 | Marble Run Box Proxy — Impact Demo | explicit-sync | 1.0155× | 0.991–1.062 | 32.08 ms | yes | control |
| 163 | Gravity Conveyor Course — Impact Demo | native-mixed-actions | 1.0103× | 0.991–1.023 | 42.34 ms | yes | borderline |
| 164 | Ramp Spiral Sorter — Cinematic | native-step-explicit-sync | 0.9984× | 0.988–1.006 | 109.82 ms | yes | control |
| 165 | Framing Lumber Stack — Baseline | active-step-sync | 1.0023× | 0.992–1.008 | 324.86 ms | yes | control |
| 166 | Skyscraper Floor Pack Drop — Baseline | explicit-sync | 0.9937× | 0.977–1.006 | 33.74 ms | yes | control |
| 167 | Modular House Assembly — High Stress | native-mixed-actions | 1.0101× | 0.993–1.045 | 45.30 ms | yes | borderline |
| 168 | Roof Truss Knockdown — Precision | native-step-explicit-sync | 0.9943× | 0.989–1.000 | 331.22 ms | yes | control |
| 169 | Foundation Block Layout — Precision | active-step-sync | 0.9901× | 0.984–0.999 | 354.47 ms | yes | control |
| 170 | Shed Builder Stress Test — Impact Demo | explicit-sync | 0.9842× | 0.964–1.000 | 33.25 ms | yes | control |
| 171 | Scaffold Stability Lab — Cinematic | native-mixed-actions | 0.9964× | 0.978–1.008 | 46.15 ms | yes | borderline |
| 172 | Warehouse Sorter Chaos — Baseline | native-step-explicit-sync | 1.0063× | 0.981–1.019 | 106.42 ms | yes | control |
| 173 | Fork Aisle Blockage — Baseline | active-step-sync | 0.9947× | 0.978–1.009 | 102.77 ms | yes | control |
| 174 | Loading Dock Impact — High Stress | explicit-sync | 0.9765× | 0.964–0.987 | 35.99 ms | yes | control |
| 175 | Rack Collapse Test — Precision | native-mixed-actions | 0.9966× | 0.989–1.003 | 45.99 ms | yes | borderline |
| 176 | Crate Pyramid Shipping — Precision | native-step-explicit-sync | 1.0001× | 0.988–1.010 | 102.38 ms | yes | control |
| 177 | Parcel Rain Sort — Impact Demo | active-step-sync | 1.0042× | 0.991–1.014 | 113.68 ms | yes | control |
| 178 | Conveyor Merge Jam — Cinematic | explicit-sync | 0.9918× | 0.983–1.012 | 32.38 ms | yes | control |
| 179 | Inventory Earthquake Proxy — Cinematic | native-mixed-actions | 1.0076× | 0.978–1.030 | 41.73 ms | yes | borderline |
| 180 | Archway Contact Test — Baseline | native-step-explicit-sync | 0.9946× | 0.989–0.998 | 276.29 ms | yes | control |
| 181 | Cathedral Nave Blocks — High Stress | active-step-sync | 0.9972× | 0.990–1.006 | 262.77 ms | yes | control |
| 182 | Temple Colonnade Collapse — Precision | explicit-sync | 1.0072× | 0.983–1.063 | 34.31 ms | yes | control |
| 183 | Facade Panel Fall — Precision | native-mixed-actions | 1.0104× | 0.990–1.030 | 36.72 ms | yes | borderline |
| 184 | Dome Ring Compression — Impact Demo | native-step-explicit-sync | 0.9869× | 0.980–0.993 | 274.13 ms | yes | control |
| 185 | Museum Atrium Drop — Cinematic | active-step-sync | 0.9923× | 0.978–0.999 | 242.80 ms | yes | control |
| 186 | Courtyard Pavilion Impact — Cinematic | explicit-sync | 1.0108× | 0.991–1.035 | 33.61 ms | yes | control |
| 187 | Warehouse Pallet Pile — Baseline | native-mixed-actions | 0.9979× | 0.981–1.010 | 505.35 ms | yes | borderline |
| 188 | Jenga Shear Test — High Stress | native-step-explicit-sync | 1.0062× | 0.975–1.037 | 1910.55 ms | yes | control |
| 189 | Cross-Laminated Block Grid — High Stress | active-step-sync | 1.0066× | 0.966–1.034 | 1977.08 ms | yes | control |
| 190 | Masonry Wall Buckling — Precision | explicit-sync | 0.9918× | 0.980–1.005 | 39.44 ms | yes | control |
| 191 | Pyramid Settling Stack — Impact Demo | native-mixed-actions | 0.9860× | 0.970–1.016 | 433.37 ms | yes | borderline |
| 192 | Mega Stack Collapse — Cinematic | native-step-explicit-sync | 1.0084× | 0.985–1.019 | 2035.78 ms | yes | control |
| 193 | Column Forest Compression — Cinematic | active-step-sync | 0.9984× | 0.961–1.034 | 2123.07 ms | yes | control |
| 194 | Concentric Contact Rings — Baseline | explicit-sync | 0.9666× | 0.958–0.973 | 19.47 ms | yes | control |
| 195 | Spiral Domino Garden — High Stress | native-mixed-actions | 0.9865× | 0.961–1.000 | 35.86 ms | yes | borderline |
| 196 | Nested Figure Eight — High Stress | native-step-explicit-sync | 0.9905× | 0.981–1.003 | 34.85 ms | yes | control |
| 197 | Long Hallway Chain — Precision | active-step-sync | 0.9990× | 0.993–1.012 | 40.72 ms | yes | control |
| 198 | Double Helix Dominoes — Impact Demo | explicit-sync | 0.9828× | 0.974–0.992 | 21.78 ms | yes | control |
| 199 | Thin-Body Stability Trial — Impact Demo | native-mixed-actions | 0.9996× | 0.986–1.013 | 35.20 ms | yes | borderline |
| 200 | S-Curve Cascade — Cinematic | native-step-explicit-sync | 1.0045× | 0.997–1.010 | 46.89 ms | yes | control |
