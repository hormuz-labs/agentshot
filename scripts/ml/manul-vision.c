// manul-vision: faces (YuNet) or objects (YOLOX, 80 COCO classes) in a stream of video frames, as JSON lines, for
// Manul's find_subjects tool. onnxruntime statically linked by scripts/build-ml.sh.
//   ffmpeg … -vf scale=W:H -pix_fmt bgr24 -f rawvideo - | manul-vision --model yunet|yolox --file m.onnx --width W --height H
// One line per frame: {"i":0,"d":[[x,y,w,h,score,class],…]} — boxes as fractions of the frame (x,y = top-left);
// class is 0 for faces, the COCO class index for objects (0 person, 2 car, 16 dog…).
//   manul-vision --info --file m.onnx     the model's inputs and outputs
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "onnxruntime_c_api.h"

static const OrtApi *ort;
#define CHECK(x) do { OrtStatus *st_ = (x); if (st_) { fprintf(stderr, "manul-vision: %s\n", ort->GetErrorMessage(st_)); exit(1); } } while (0)

typedef struct { float x, y, w, h, score; int cls; } Det;

static float iou(const Det *a, const Det *b) {
  float x1 = fmaxf(a->x, b->x), y1 = fmaxf(a->y, b->y);
  float x2 = fminf(a->x + a->w, b->x + b->w), y2 = fminf(a->y + a->h, b->y + b->h);
  float inter = fmaxf(0, x2 - x1) * fmaxf(0, y2 - y1);
  float u = a->w * a->h + b->w * b->h - inter;
  return u > 0 ? inter / u : 0;
}
static int by_score(const void *a, const void *b) {
  float d = ((const Det *)b)->score - ((const Det *)a)->score;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}
/** Greedy non-maximum suppression within each class; returns the kept count (kept ones moved to the front). */
static int nms(Det *d, int n, float thr) {
  qsort(d, n, sizeof *d, by_score);
  int kept = 0;
  for (int i = 0; i < n; i++) {
    int ok = 1;
    for (int k = 0; k < kept && ok; k++) if (d[k].cls == d[i].cls && iou(&d[k], &d[i]) > thr) ok = 0;
    if (ok) d[kept++] = d[i];
  }
  return kept;
}

static float *output(OrtValue *v) { float *p; CHECK(ort->GetTensorMutableData(v, (void **)&p)); return p; }

int main(int argc, char **argv) {
  const char *model = NULL, *file = NULL;
  int W = 0, H = 0, info = 0, threads = 4;
  float score_thr = -1;
  for (int i = 1; i < argc; i++) {
    if (!strcmp(argv[i], "--model") && i + 1 < argc) model = argv[++i];
    else if (!strcmp(argv[i], "--file") && i + 1 < argc) file = argv[++i];
    else if (!strcmp(argv[i], "--width") && i + 1 < argc) W = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--height") && i + 1 < argc) H = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--score") && i + 1 < argc) score_thr = (float)atof(argv[++i]);
    else if (!strcmp(argv[i], "--threads") && i + 1 < argc) threads = atoi(argv[++i]);
    else if (!strcmp(argv[i], "--info")) info = 1;
  }
  if (!file || (!info && (!model || W <= 0 || H <= 0))) {
    fprintf(stderr, "usage: manul-vision --model yunet|yolox --file model.onnx --width W --height H [--score S] [--threads N] < bgr24 frames\n");
    return 2;
  }
  ort = OrtGetApiBase()->GetApi(ORT_API_VERSION);
  OrtEnv *env; CHECK(ort->CreateEnv(ORT_LOGGING_LEVEL_ERROR, "manul-vision", &env));
  OrtSessionOptions *so; CHECK(ort->CreateSessionOptions(&so));
  CHECK(ort->SetIntraOpNumThreads(so, threads > 0 ? threads : 4));
  OrtSession *sess; CHECK(ort->CreateSession(env, file, so, &sess));
  OrtAllocator *alloc; CHECK(ort->GetAllocatorWithDefaultOptions(&alloc));

  size_t nin, nout; CHECK(ort->SessionGetInputCount(sess, &nin)); CHECK(ort->SessionGetOutputCount(sess, &nout));
  char **in_names = calloc(nin, sizeof(char *)), **out_names = calloc(nout, sizeof(char *));
  int64_t in_dims[4] = {1, 3, -1, -1};
  for (size_t i = 0; i < nin; i++) {
    CHECK(ort->SessionGetInputName(sess, i, alloc, &in_names[i]));
    OrtTypeInfo *ti; CHECK(ort->SessionGetInputTypeInfo(sess, i, &ti));
    const OrtTensorTypeAndShapeInfo *tsi; CHECK(ort->CastTypeInfoToTensorInfo(ti, &tsi));
    size_t nd; CHECK(ort->GetDimensionsCount(tsi, &nd));
    int64_t dims[8] = {0}; CHECK(ort->GetDimensions(tsi, dims, nd < 8 ? nd : 8));
    if (i == 0 && nd == 4) memcpy(in_dims, dims, sizeof in_dims);
    if (info) { printf("input %s [", in_names[i]); for (size_t k = 0; k < nd; k++) printf("%s%lld", k ? "," : "", (long long)dims[k]); printf("]\n"); }
    ort->ReleaseTypeInfo(ti);
  }
  for (size_t i = 0; i < nout; i++) {
    CHECK(ort->SessionGetOutputName(sess, i, alloc, &out_names[i]));
    if (info) printf("output %s\n", out_names[i]);
  }
  if (info) return 0;

  int yunet = !strcmp(model, "yunet");
  if (score_thr < 0) score_thr = yunet ? 0.6f : 0.35f;
  // network input size: YuNet takes any size padded to a multiple of 32 (or its fixed size); YOLOX a fixed square
  int nw, nh;
  if (in_dims[2] > 0 && in_dims[3] > 0) { nh = (int)in_dims[2]; nw = (int)in_dims[3]; }
  else { nw = (W + 31) / 32 * 32; nh = (H + 31) / 32 * 32; }
  // frames are scaled into the network input keeping their shape (top-left, the rest padded)
  float r = fminf((float)nw / W, (float)nh / H);
  if (yunet && in_dims[2] <= 0) r = 1;
  int rw = (int)(W * r), rh = (int)(H * r);

  size_t frame_bytes = (size_t)W * H * 3;
  unsigned char *frame = malloc(frame_bytes);
  float *input = malloc(sizeof(float) * 3 * nw * nh);
  OrtMemoryInfo *mem; CHECK(ort->CreateCpuMemoryInfo(OrtArenaAllocator, OrtMemTypeDefault, &mem));
  int64_t shape[4] = {1, 3, nh, nw};
  int cap = 4096; Det *dets = malloc(sizeof(Det) * cap);

  for (long fi = 0; fread(frame, 1, frame_bytes, stdin) == frame_bytes; fi++) {
    float pad = yunet ? 0.f : 114.f;
    for (size_t k = 0; k < (size_t)3 * nw * nh; k++) input[k] = pad;
    for (int y = 0; y < rh; y++) {
      int sy = (int)(y / r); if (sy >= H) sy = H - 1;
      for (int x = 0; x < rw; x++) {
        int sx = (int)(x / r); if (sx >= W) sx = W - 1;
        const unsigned char *p = frame + ((size_t)sy * W + sx) * 3; // BGR, as both models expect
        for (int c = 0; c < 3; c++) input[(size_t)c * nw * nh + (size_t)y * nw + x] = p[c];
      }
    }
    OrtValue *tensor = NULL;
    CHECK(ort->CreateTensorWithDataAsOrtValue(mem, input, sizeof(float) * 3 * nw * nh, shape, 4, ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT, &tensor));
    OrtValue **outs = calloc(nout, sizeof(OrtValue *));
    CHECK(ort->Run(sess, NULL, (const char *const *)in_names, (const OrtValue *const *)&tensor, 1, (const char *const *)out_names, nout, outs));

    int n = 0;
    if (yunet) {
      // outputs cls_8/16/32, obj_8/16/32, bbox_8/16/32, kps_8/16/32 (OpenCV's FaceDetectorYN decoding)
      const int strides[3] = {8, 16, 32};
      for (int si = 0; si < 3; si++) {
        char nm[16]; float *cls = NULL, *obj = NULL, *box = NULL;
        for (size_t k = 0; k < nout; k++) {
          snprintf(nm, sizeof nm, "cls_%d", strides[si]); if (!strcmp(out_names[k], nm)) cls = output(outs[k]);
          snprintf(nm, sizeof nm, "obj_%d", strides[si]); if (!strcmp(out_names[k], nm)) obj = output(outs[k]);
          snprintf(nm, sizeof nm, "bbox_%d", strides[si]); if (!strcmp(out_names[k], nm)) box = output(outs[k]);
        }
        if (!cls || !obj || !box) { fprintf(stderr, "manul-vision: not a YuNet model\n"); return 1; }
        int s = strides[si], cols = nw / s, rows = nh / s;
        for (int rr = 0; rr < rows; rr++) for (int cc = 0; cc < cols; cc++) {
          int idx = rr * cols + cc;
          float sc = sqrtf(fminf(fmaxf(cls[idx], 0), 1) * fminf(fmaxf(obj[idx], 0), 1));
          if (sc < score_thr || n >= cap) continue;
          float cx = (cc + box[idx * 4]) * s, cy = (rr + box[idx * 4 + 1]) * s;
          float w = expf(box[idx * 4 + 2]) * s, h = expf(box[idx * 4 + 3]) * s;
          dets[n++] = (Det){(cx - w / 2) / r, (cy - h / 2) / r, w / r, h / r, sc, 0};
        }
      }
      n = nms(dets, n, 0.3f);
    } else {
      // YOLOX: [1, anchors, 5 + classes] raw grid outputs (strides 8, 16, 32)
      float *p = output(outs[0]);
      OrtTensorTypeAndShapeInfo *oi; CHECK(ort->GetTensorTypeAndShape(outs[0], &oi));
      int64_t od[3]; CHECK(ort->GetDimensions(oi, od, 3)); ort->ReleaseTensorTypeAndShapeInfo(oi);
      int per = (int)od[2], classes = per - 5, a = 0;
      const int strides[3] = {8, 16, 32};
      for (int si = 0; si < 3; si++) {
        int s = strides[si], gw = nw / s, gh = nh / s;
        for (int gy = 0; gy < gh; gy++) for (int gx = 0; gx < gw; gx++, a++) {
          const float *q = p + (size_t)a * per;
          int best = 0; for (int c = 1; c < classes; c++) if (q[5 + c] > q[5 + best]) best = c;
          float sc = q[4] * q[5 + best];
          if (sc < score_thr || n >= cap) continue;
          float cx = (q[0] + gx) * s, cy = (q[1] + gy) * s, w = expf(q[2]) * s, h = expf(q[3]) * s;
          dets[n++] = (Det){(cx - w / 2) / r, (cy - h / 2) / r, w / r, h / r, sc, best};
        }
      }
      n = nms(dets, n, 0.45f);
    }

    printf("{\"i\":%ld,\"d\":[", fi);
    for (int k = 0; k < n && k < 20; k++) {
      Det *d = &dets[k];
      float x = fmaxf(0, d->x / W), y = fmaxf(0, d->y / H);
      float w = fminf(1 - x, d->w / W), h = fminf(1 - y, d->h / H);
      printf("%s[%.4f,%.4f,%.4f,%.4f,%.3f,%d]", k ? "," : "", x, y, w, h, d->score, d->cls);
    }
    printf("]}\n");
    fflush(stdout);
    for (size_t k = 0; k < nout; k++) ort->ReleaseValue(outs[k]);
    free(outs);
    ort->ReleaseValue(tensor);
  }
  return 0;
}
