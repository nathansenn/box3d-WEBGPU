# WebPhysics v1.13 shard 9/10

Generated: 2026-07-16T21:43:42.580Z

Cases: **100**; group: **renderer-cpu-webgpu**; smoke: **false**.

Registry: `ac38d476ee69c222ce9fb7380d9d53eb30b101e0dd34a1e13be9334fe0c9c032`

Candidate source: `9baae5ee1004276a5937b66a1eae13f3c2776f3d198edd2a5637f231b1286cbe`

Harness closure: `6b54d5e2a7bc71d086b860c9384dd36d5951630399faeeb21a7c093072c5fcb9`

| ID | Scene | Protocol | Speedup | 95% CI | Min batch | Correct | Decision |
|---:|---|---|---:|---:|---:|---|---|
| 801 | Native scene null | rigid-active-upload | 1.0654× | 1.012–1.091 | 28.76 ms | yes | control |
| 802 | Native scene null | rigid-unchanged-upload | 1.0368× | 0.836–1.206 | 23.55 ms | yes | control |
| 803 | Native scene null | rigid-active-upload | 1.0027× | 0.940–1.034 | 31.58 ms | yes | control |
| 804 | Native scene null | rigid-unchanged-upload | 0.9617× | 0.831–1.099 | 24.80 ms | yes | control |
| 805 | Native scene null | rigid-active-upload | 1.0250× | 0.992–1.074 | 27.39 ms | yes | control |
| 806 | Native scene null | rigid-unchanged-upload | 0.7715× | 0.675–0.996 | 42.04 ms | yes | control |
| 807 | Native scene null | rigid-active-upload | 0.9874× | 0.974–1.010 | 30.42 ms | yes | control |
| 808 | Native scene null | rigid-unchanged-upload | 0.9032× | 0.780–1.099 | 21.05 ms | yes | control |
| 809 | Native scene null | rigid-active-upload | 1.0086× | 0.964–1.034 | 31.98 ms | yes | control |
| 810 | Native scene null | rigid-unchanged-upload | 0.9119× | 0.764–1.023 | 25.01 ms | yes | control |
| 811 | Native scene null | rigid-active-upload | 0.9771× | 0.921–1.031 | 24.72 ms | yes | control |
| 812 | Native scene null | rigid-unchanged-upload | 1.2192× | 0.872–1.752 | 25.13 ms | yes | control |
| 813 | Native scene null | rigid-active-upload | 0.9837× | 0.969–1.017 | 26.89 ms | yes | control |
| 814 | Native scene null | rigid-unchanged-upload | 1.0113× | 0.874–1.166 | 23.99 ms | yes | control |
| 815 | Native scene null | rigid-active-upload | 1.0011× | 0.964–1.054 | 28.72 ms | yes | control |
| 816 | Native scene null | rigid-unchanged-upload | 0.9338× | 0.810–1.071 | 24.47 ms | yes | control |
| 817 | Native scene null | rigid-active-upload | 1.0530× | 0.981–1.119 | 30.81 ms | yes | control |
| 818 | Native scene null | rigid-unchanged-upload | 0.9246× | 0.814–1.081 | 30.23 ms | yes | control |
| 819 | Native scene null | rigid-active-upload | 0.9852× | 0.979–1.014 | 37.72 ms | yes | control |
| 820 | Native scene null | rigid-unchanged-upload | 1.0371× | 0.905–1.185 | 26.43 ms | yes | control |
| 821 | Native scene null | cloth-active-upload | 1.2261× | 1.173–1.342 | 37.86 ms | yes | accepted-provisional |
| 822 | Native scene null | cloth-unchanged-upload | 4.9105× | 3.584–5.804 | 16.14 ms | yes | accepted-provisional |
| 823 | Native scene null | cloth-active-upload | 1.2833× | 1.222–1.340 | 40.64 ms | yes | accepted-provisional |
| 824 | Native scene null | cloth-unchanged-upload | 4.5119× | 3.246–7.544 | 12.20 ms | yes | accepted-provisional |
| 825 | Native scene null | cloth-active-upload | 1.4287× | 1.280–1.508 | 35.61 ms | yes | accepted-provisional |
| 826 | Native scene null | cloth-unchanged-upload | 3.4187× | 3.029–3.974 | 21.84 ms | yes | accepted-provisional |
| 827 | Native scene null | cloth-active-upload | 1.3611× | 1.275–1.412 | 31.65 ms | yes | accepted-provisional |
| 828 | Native scene null | cloth-unchanged-upload | 6.7436× | 3.889–9.096 | 13.28 ms | yes | accepted-provisional |
| 829 | Native scene null | cloth-active-upload | 1.4571× | 1.201–1.985 | 26.02 ms | yes | accepted-provisional |
| 830 | Native scene null | cloth-unchanged-upload | 3.2070× | 2.363–5.111 | 16.05 ms | yes | accepted-provisional |
| 831 | Native scene null | cloth-active-upload | 1.2494× | 1.015–1.493 | 25.73 ms | yes | accepted-provisional |
| 832 | Native scene null | cloth-unchanged-upload | 2.5917× | 2.331–3.571 | 17.78 ms | yes | accepted-provisional |
| 833 | Native scene null | cloth-active-upload | 1.2907× | 1.184–1.446 | 27.41 ms | yes | accepted-provisional |
| 834 | Native scene null | cloth-unchanged-upload | 3.9822× | 2.434–5.536 | 19.24 ms | yes | accepted-provisional |
| 835 | Native scene null | cloth-active-upload | 1.2278× | 1.056–1.374 | 36.85 ms | yes | accepted-provisional |
| 836 | Native scene null | cloth-unchanged-upload | 3.5733× | 2.657–6.700 | 11.18 ms | yes | accepted-provisional |
| 837 | Native scene null | cloth-active-upload | 1.4191× | 1.117–1.584 | 18.06 ms | yes | accepted-provisional |
| 838 | Native scene null | cloth-unchanged-upload | 6.5230× | 5.557–8.561 | 14.64 ms | yes | accepted-provisional |
| 839 | Native scene null | cloth-active-upload | 1.1775× | 0.945–1.590 | 25.09 ms | yes | borderline |
| 840 | Native scene null | cloth-unchanged-upload | 3.8469× | 2.440–4.472 | 19.70 ms | yes | accepted-provisional |
| 841 | Native scene null | water-active-upload | 1.1871× | 1.067–1.418 | 24.98 ms | yes | accepted-provisional |
| 842 | Native scene null | water-unchanged-upload | 5.4918× | 2.849–7.041 | 18.80 ms | yes | accepted-provisional |
| 843 | Native scene null | water-active-upload | 1.1447× | 1.087–1.212 | 40.97 ms | yes | accepted-provisional |
| 844 | Native scene null | water-unchanged-upload | 3.1036× | 2.037–5.357 | 9.02 ms | yes | accepted-provisional |
| 845 | Native scene null | water-active-upload | 1.1106× | 1.075–1.178 | 42.63 ms | yes | accepted-provisional |
| 846 | Native scene null | water-unchanged-upload | 6.8000× | 4.441–7.937 | 17.96 ms | yes | accepted-provisional |
| 847 | Native scene null | water-active-upload | 1.2407× | 1.168–1.292 | 40.31 ms | yes | accepted-provisional |
| 848 | Native scene null | water-unchanged-upload | 4.7238× | 4.375–5.500 | 14.32 ms | yes | accepted-provisional |
| 849 | Native scene null | water-active-upload | 1.1310× | 1.077–1.261 | 23.46 ms | yes | accepted-provisional |
| 850 | Native scene null | water-unchanged-upload | 3.8572× | 2.505–5.552 | 9.01 ms | yes | accepted-provisional |
| 851 | Native scene null | water-active-upload | 1.2210× | 1.120–1.717 | 29.79 ms | yes | accepted-provisional |
| 852 | Native scene null | water-unchanged-upload | 2.2793× | 1.885–2.952 | 21.29 ms | yes | accepted-provisional |
| 853 | Native scene null | water-active-upload | 1.2625× | 1.060–1.335 | 30.35 ms | yes | accepted-provisional |
| 854 | Native scene null | water-unchanged-upload | 2.0880× | 1.838–2.694 | 43.59 ms | yes | accepted-provisional |
| 855 | Native scene null | water-active-upload | 1.1002× | 0.999–1.147 | 47.20 ms | yes | borderline |
| 856 | Native scene null | water-unchanged-upload | 2.8478× | 2.278–3.757 | 18.82 ms | yes | accepted-provisional |
| 857 | Native scene null | water-active-upload | 1.1633× | 1.132–1.558 | 41.18 ms | yes | accepted-provisional |
| 858 | Native scene null | water-unchanged-upload | 2.6863× | 2.365–4.412 | 22.52 ms | yes | accepted-provisional |
| 859 | Native scene null | water-active-upload | 1.2305× | 1.158–1.728 | 19.82 ms | yes | accepted-provisional |
| 860 | Native scene null | water-unchanged-upload | 2.5191× | 2.114–4.206 | 19.52 ms | yes | accepted-provisional |
| 861 | Native scene null | rope-active-upload | 1.0785× | 1.004–1.126 | 26.25 ms | yes | control |
| 862 | Native scene null | rope-unchanged-upload | 0.9208× | 0.804–1.107 | 40.99 ms | yes | control |
| 863 | Native scene null | rope-active-upload | 0.9807× | 0.921–1.147 | 28.12 ms | yes | control |
| 864 | Native scene null | rope-unchanged-upload | 1.1373× | 0.982–1.207 | 34.30 ms | yes | control |
| 865 | Native scene null | rope-active-upload | 1.0106× | 0.883–1.059 | 32.48 ms | yes | control |
| 866 | Native scene null | rope-unchanged-upload | 0.9544× | 0.744–1.188 | 28.32 ms | yes | control |
| 867 | Native scene null | rope-active-upload | 1.0267× | 0.923–1.105 | 31.23 ms | yes | control |
| 868 | Native scene null | rope-unchanged-upload | 0.9919× | 0.865–1.158 | 29.20 ms | yes | control |
| 869 | Native scene null | rope-active-upload | 1.0628× | 0.997–1.088 | 29.29 ms | yes | control |
| 870 | Native scene null | rope-unchanged-upload | 0.9552× | 0.800–1.091 | 41.37 ms | yes | control |
| 871 | Native scene null | effects-active-upload | 1.0289× | 0.975–1.086 | 30.57 ms | yes | control |
| 872 | Native scene null | effects-unchanged-upload | 1.0072× | 0.870–1.152 | 25.28 ms | yes | control |
| 873 | Native scene null | effects-active-upload | 1.0159× | 0.971–1.058 | 36.29 ms | yes | control |
| 874 | Native scene null | effects-unchanged-upload | 0.9824× | 0.893–1.047 | 37.13 ms | yes | control |
| 875 | Native scene null | effects-active-upload | 1.0022× | 0.992–1.026 | 30.21 ms | yes | control |
| 876 | Native scene null | effects-unchanged-upload | 0.9429× | 0.835–1.107 | 27.86 ms | yes | control |
| 877 | Native scene null | effects-active-upload | 0.9991× | 0.946–1.063 | 28.13 ms | yes | control |
| 878 | Native scene null | effects-unchanged-upload | 1.0050× | 0.828–1.563 | 16.76 ms | yes | control |
| 879 | Native scene null | effects-active-upload | 1.0224× | 0.996–1.086 | 30.16 ms | yes | control |
| 880 | Native scene null | effects-unchanged-upload | 0.9150× | 0.776–1.005 | 26.89 ms | yes | control |
| 881 | Native scene null | uniforms-resize-dedup | 0.9444× | 0.935–1.011 | 137.72 ms | yes | control |
| 882 | Native scene null | uniforms-resize-dedup | 1.0255× | 0.976–1.052 | 57.51 ms | yes | control |
| 883 | Native scene null | uniforms-resize-dedup | 0.9835× | 0.916–1.063 | 46.23 ms | yes | control |
| 884 | Native scene null | uniforms-resize-dedup | 1.0341× | 1.006–1.092 | 161.77 ms | yes | control |
| 885 | Native scene null | uniforms-resize-dedup | 1.0386× | 0.995–1.083 | 132.85 ms | yes | control |
| 886 | Native scene null | uniforms-resize-dedup | 0.9669× | 0.899–1.112 | 78.16 ms | yes | control |
| 887 | Native scene null | uniforms-resize-dedup | 0.9269× | 0.869–1.094 | 50.60 ms | yes | control |
| 888 | Native scene null | uniforms-delayed-resize | 1.0470× | 1.009–1.129 | 71.22 ms | yes | control |
| 889 | Native scene null | uniforms-delayed-resize | 0.9880× | 0.976–1.053 | 89.21 ms | yes | control |
| 890 | Native scene null | uniforms-delayed-resize | 0.9624× | 0.852–1.044 | 59.65 ms | yes | control |
| 891 | Native scene null | uniforms-delayed-resize | 1.0258× | 0.961–1.080 | 159.28 ms | yes | control |
| 892 | Native scene null | uniforms-delayed-resize | 0.9998× | 0.960–1.065 | 77.39 ms | yes | control |
| 893 | Native scene null | uniforms-delayed-resize | 0.9986× | 0.934–1.058 | 63.67 ms | yes | control |
| 894 | Native scene null | uniforms-delayed-resize | 0.9609× | 0.918–0.996 | 66.14 ms | yes | control |
| 895 | Native scene null | uniforms-active-resize | 1.0387× | 0.921–1.101 | 78.85 ms | yes | control |
| 896 | Native scene null | uniforms-active-resize | 0.9766× | 0.919–1.068 | 92.78 ms | yes | control |
| 897 | Native scene null | uniforms-active-resize | 0.9940× | 0.875–1.092 | 54.03 ms | yes | control |
| 898 | Native scene null | uniforms-active-resize | 0.9809× | 0.930–1.045 | 85.45 ms | yes | control |
| 899 | Native scene null | uniforms-active-resize | 1.1004× | 0.993–1.213 | 58.06 ms | yes | control |
| 900 | Native scene null | uniforms-active-resize | 0.9890× | 0.928–1.279 | 51.24 ms | yes | control |
