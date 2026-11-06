# SV07 twin-motor printed plane, and CF Twin (planned)

Status: **designed, not printed.** Source chat: "3D printed plane design" (Oct 13 2026). Based on the SonicModell Binary, reworked for printing with a bigger bay. Not a VTOL.

## Source files (attach)
- `SV07_plane_STL_pack.zip` (35 STLs, AGENT_HANDOFF_SV07.md, parts_report.json, mass_cg.json, PDF packet), or the later 47-STL manual package with ID-named folders (F fuselage, H hatches, W wing, P pods, T tail, A accessories, X bought parts, S bed plates) and `print_manifest.csv`.

## Key specs (from the packet)
- Span 4.6 ft, chord 0.69 ft, NACA 2415. Fuselage 3.3 ft in five sections with spigot joints and crush ribs.
- V-tail 38 degrees, two ruddervators on nylon hinges.
- Two wing-mounted tractor motors, 10 in props. 750 KV class on 6S (900-1000 KV class on 4S).
- Battery bay sized for Tattu 6S 7000 (assumed 136x42x68 in that chat; conflicts with the 163x65x55 sleeve chat, measure).
- Pixhawk V5+ on a nose shelf, GPS on the avionics hatch, airspeed sensor and pitot at the nose.
- Flat belly pad for Alex's screw-on landing gear.

## Printer agent rules (from AGENT_HANDOFF_SV07.md)
- SV07, Klipper, 220x220x250, 0.4 nozzle, PLA 205-215 C, bed 60 C. Files in print orientation; do not rotate or scale.
- Wings, ailerons, tail: 2 walls, 3% gyroid, 4 top/bottom. Fuselage, pods, hatches, covers: 3 walls, 5% gyroid.
- 0.20 layer, fan 100% after layer 3, outer walls 50 mm/s. Brim 5 mm; 8 mm on ailerons and tail.
- Fit values: 0.30 clearance, 0.45 crush ribs. Do not change holes, slots or ribs.

## Open items
Hinge leaf thickness (assumed 1.3 mm), landing gear screw pattern, motor model and mount bolt pattern.

## CF Twin (planned, not started)
Hybrid: CF plate formers, ribs, motor and gear plates (PCBWay), CF tube spar, printed nylon skins (JLC MJF PA12), aluminum from JLC. Wing stretched to 7.5 ft. Bigger servos than the 9g in the SV07 design. Needs the SV07 pack attached as the base.
