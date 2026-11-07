# Materials

`filaments.json`: filament properties from the makers' technical data sheets, for the Stress Lab (roadmap 1.6) and material choices in estimates. Each entry names the document, version and URL it came from. A value the sheet does not give is left out, never estimated.

> See also: [Roadmap](../docs/ROADMAP-MTS.md) | [All docs](../docs/README.md)

Brands: eSUN, Polymaker, Prusament (owner's choice: no Bambu Lab). Pending: standard Prusament grades (PDF text is font-scrambled, needs reading by hand), Overture, SUNLU, Hatchbox, Elegoo.

Read the numbers with care:
- Datasheet values come from test bars printed at 100 % infill under the maker's settings (listed in `specimen`). Your parts have walls and partial infill, so they are weaker.
- `z` (across layers) is the weak direction: eSUN PLA+ 36 MPa vs 70 MPa in X-Y.
- Different makers test differently (GB/T vs ISO, chamber vs open air, Prusa's "vertical xz" bars lie on edge and do not test layer adhesion). Compare within one brand, or calibrate with your own test print.
- Add your own measured values as a new entry with `"brand": "MTS test"` and the test notes.
