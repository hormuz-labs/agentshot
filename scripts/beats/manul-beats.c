// SPDX-License-Identifier: GPL-3.0-or-later (it is compiled together with aubio; see LICENSES/GPL-3.0.txt)
// manul-beats: the beats, onsets and energy of a piece of music, as JSON on stdout, for Manul's analyze_music tool.
// Built on aubio (GPL-3.0-or-later, https://aubio.org) by scripts/build-beats.sh. Reads 16/24/32-bit PCM WAV:
// Manul decodes anything else to WAV with its ffmpeg first.
//   manul-beats in.wav
// {"sr":44100,"duration":61.2,"bpm":120.1,"confidence":0.42,"beats":[0.51,1.01,…],
//  "onsets":[[0.50,0.83],…],             onset time and its strength (aubio's onset descriptor at that moment)
//  "env":{"rate":20,"rms":[…],"flux":[…]}}  loudness (linear RMS) and spectral flux, 20 values a second
#include <aubio/aubio.h>
#include <stdio.h>
#include <stdlib.h>

#define WIN 1024
#define HOP 256
#define ENV_RATE 20

static void num(double v) { printf("%.4f", v); }

int main(int argc, char **argv) {
  if (argc != 2) { fprintf(stderr, "usage: manul-beats in.wav\n"); return 2; }
  aubio_source_t *src = new_aubio_source(argv[1], 0, HOP);
  if (!src) { fprintf(stderr, "manul-beats: cannot read %s (16/24/32-bit PCM WAV only)\n", argv[1]); return 1; }
  uint_t sr = aubio_source_get_samplerate(src);
  aubio_tempo_t *tempo = new_aubio_tempo("default", WIN, HOP, sr);
  aubio_onset_t *onset = new_aubio_onset("specflux", WIN, HOP, sr);
  if (!tempo || !onset) { fprintf(stderr, "manul-beats: aubio could not start\n"); return 1; }
  aubio_onset_set_minioi_s(onset, 0.05);
  fvec_t *in = new_fvec(HOP), *beat = new_fvec(1), *on = new_fvec(1);

  size_t nb = 0, cb = 1024, no = 0, co = 1024, ne = 0, ce = 4096;
  double *beats = malloc(cb * sizeof *beats), *ons = malloc(co * 2 * sizeof *ons), *rms = malloc(ce * sizeof *rms), *flux = malloc(ce * sizeof *flux);
  uint_t per_env = sr / ENV_RATE / HOP ? sr / ENV_RATE / HOP : 1; // hops per envelope value
  double acc_rms = 0, acc_flux = 0; uint_t acc_n = 0;
  uint_t read = 0, total = 0;
  do {
    aubio_source_do(src, in, &read);
    aubio_tempo_do(tempo, in, beat);
    aubio_onset_do(onset, in, on);
    if (beat->data[0] != 0) {
      if (nb == cb) beats = realloc(beats, (cb *= 2) * sizeof *beats);
      beats[nb++] = aubio_tempo_get_last_s(tempo);
    }
    smpl_t desc = aubio_onset_get_descriptor(onset);
    if (on->data[0] != 0) {
      if (no == co) ons = realloc(ons, (co *= 2) * 2 * sizeof *ons);
      ons[2 * no] = aubio_onset_get_last_s(onset);
      ons[2 * no + 1] = desc;
      no++;
    }
    acc_rms += aubio_level_lin(in); acc_flux += desc; acc_n++;
    if (acc_n == per_env) {
      if (ne == ce) { ce *= 2; rms = realloc(rms, ce * sizeof *rms); flux = realloc(flux, ce * sizeof *flux); }
      rms[ne] = acc_rms / acc_n; flux[ne] = acc_flux / acc_n; ne++;
      acc_rms = acc_flux = 0; acc_n = 0;
    }
    total += read;
  } while (read == HOP);

  printf("{\"sr\":%u,\"duration\":", sr); num((double)total / sr);
  printf(",\"bpm\":"); num(aubio_tempo_get_bpm(tempo));
  printf(",\"confidence\":"); num(aubio_tempo_get_confidence(tempo));
  printf(",\"beats\":[");
  for (size_t i = 0; i < nb; i++) { if (i) putchar(','); num(beats[i]); }
  printf("],\"onsets\":[");
  for (size_t i = 0; i < no; i++) { if (i) putchar(','); putchar('['); num(ons[2 * i]); putchar(','); num(ons[2 * i + 1]); putchar(']'); }
  printf("],\"env\":{\"rate\":");
  num((double)sr / HOP / per_env);
  printf(",\"rms\":[");
  for (size_t i = 0; i < ne; i++) { if (i) putchar(','); num(rms[i]); }
  printf("],\"flux\":[");
  for (size_t i = 0; i < ne; i++) { if (i) putchar(','); num(flux[i]); }
  printf("]}}\n");

  del_fvec(in); del_fvec(beat); del_fvec(on);
  del_aubio_tempo(tempo); del_aubio_onset(onset); del_aubio_source(src);
  aubio_cleanup();
  free(beats); free(ons); free(rms); free(flux);
  return 0;
}
