# STL Tools documentation

Every guide lives in this repository, so it matches the version you run (the packages include this folder as `app/docs`). Start with the row that fits what you want to do.

## Start here

| I want to | Read |
|---|---|
| Download and start it on Windows, macOS or Linux | [INSTALL.md](INSTALL.md) |
| Run it on a Raspberry Pi 4 / 4B / 5 as a shop server | [RASPBERRY-PI.md](RASPBERRY-PI.md) |
| Run it from a USB drive, for one session, for a few hours, or for my whole network | [SELF-HOSTING.md](SELF-HOSTING.md) |
| Learn the app: parts, presets, projects, assemblies, estimates | [USER-GUIDE.md](USER-GUIDE.md) |
| See layers before slicing, view G-code files, split big parts for the bed | [USER-GUIDE.md](USER-GUIDE.md#layer-preview-and-g-code-viewer-mts-edition) |
| Build a modular quad frame, board holders, camera cases | [USER-GUIDE.md](USER-GUIDE.md#quad-frames-boards-cameras-antennas-mts-edition) |
| Test a part for stress, weak points, supports, wind tunnel airflow, heat, sun, rain | [STRESS-LAB.md](STRESS-LAB.md) |
| Connect my Sovol SV07 or other Klipper printer directly: live status, console, webcam, pre-print checklist, G-code viewer, opt-in control | [PRINTERS.md](PRINTERS.md) |
| Get print times that fit my printer, import my slicer profile | [PRINTER-PROFILES.md](PRINTER-PROFILES.md) |
| Fix something | [TROUBLESHOOTING.md](TROUBLESHOOTING.md), [FAQ.md](FAQ.md) |
| Test a new version and send feedback | [TESTING.md](TESTING.md) |
| See what comes next in the MTS edition | [ROADMAP-MTS.md](ROADMAP-MTS.md) |
| How slicing for the SV07 works (Sovol / OrcaSlicer / Muse) | [SLICING-RESEARCH.md](SLICING-RESEARCH.md) |
| Filament properties from maker datasheets | [../materials/README.md](../materials/README.md) |

## Folder guides (the wiki)

Each folder explains itself:

| Folder | Read |
|---|---|
| Engine: kernel, estimates, printers, projects, layer slicer, splitter | [../src/core/README.md](../src/core/README.md) |
| Stress Lab engines: FEA, weak points, aerodynamics, environment (methods, accuracy) | [../src/core/lab/README.md](../src/core/lab/README.md) |
| Generators: every file, and how to write one | [../src/generators/README.md](../src/generators/README.md) |
| Browser app: pages and viewers | [../public/README.md](../public/README.md) |
| Presets | [../presets/README.md](../presets/README.md) |
| Printer profiles | [../printer-profiles/README.md](../printer-profiles/README.md) |
| Pre-print checklists and G-code header rules | [../checklists/README.md](../checklists/README.md) |
| Filament data | [../materials/README.md](../materials/README.md) |
| MTS starter data (parts list, ideas, assemblies) | [../seed/mts-v1/README.md](../seed/mts-v1/README.md) |
| Your own files (custom folder) | [../custom/README.md](../custom/README.md) |
| Raspberry Pi installer and service | [../deploy/README.md](../deploy/README.md) |
| Build, package, screenshot and smoke-test scripts | [../scripts/README.md](../scripts/README.md) |
| Test suites and the fake printer | [../test/README.md](../test/README.md) |

## Make it yours

| I want to | Read |
|---|---|
| Add my own presets, generators, printer profiles (no code change) | [../custom/README.md](../custom/README.md) |
| Preset file format | [../presets/README.md](../presets/README.md) |
| Write a generator (kernel functions, printability rules) | [../src/generators/README.md](../src/generators/README.md) |
| My Parts list format (`components.json`) | [../seed/mts-v1/README.md](../seed/mts-v1/README.md) |
| Add things without breaking anything; release steps | [EXTENDING.md](EXTENDING.md) |
| Share it by pull request | [../CONTRIBUTING.md](../CONTRIBUTING.md) |

## Developers and agents

| Topic | Read |
|---|---|
| Commands, hard rules, code map | [../AGENTS.md](../AGENTS.md) |
| How the server, generators, data folder and UI fit together | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Every HTTP endpoint | [API.md](API.md) |
| Installer, service file, where to run it | [../deploy/README.md](../deploy/README.md) |
| Security model and reporting | [../SECURITY.md](../SECURITY.md) |
| Versions | [../CHANGELOG.md](../CHANGELOG.md) |

Project home: [../README.md](../README.md).
