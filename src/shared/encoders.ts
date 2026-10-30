// Video encoders for working cuts: the graphics chip where there is one, libx264 otherwise. Which of these a machine can
// really use is found by trying them (main/encoders.ts). Quality is set by eye and SSIM on real footage and screen
// recordings: close to libx264 -crf 16. To add one, add its flags here and its name to the platforms it runs on.
export type Encoder = { name: string; flags: string[]; /** films pieces at once */ parallel: number }

export const SOFTWARE: Encoder = { name: 'libx264', flags: ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p'], parallel: 2 }

const HARDWARE: Record<string, Encoder> = {
  videotoolbox: { name: 'h264_videotoolbox', flags: ['-c:v', 'h264_videotoolbox', '-q:v', '78', '-allow_sw', '0', '-pix_fmt', 'yuv420p'], parallel: 4 },
  nvenc: { name: 'h264_nvenc', flags: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-tune', 'hq', '-rc', 'vbr', '-cq', '19', '-b:v', '0', '-pix_fmt', 'yuv420p'], parallel: 3 },
  qsv: { name: 'h264_qsv', flags: ['-c:v', 'h264_qsv', '-preset', 'fast', '-global_quality', '19', '-pix_fmt', 'nv12'], parallel: 3 },
  amf: { name: 'h264_amf', flags: ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '19', '-qp_p', '19', '-pix_fmt', 'nv12'], parallel: 3 },
}

/** The encoders to try on a platform, best first, ending with the one that always works. */
export function encodersFor(platform: string): Encoder[] {
  const { videotoolbox, nvenc, qsv, amf } = HARDWARE
  if (platform === 'darwin') return [videotoolbox, SOFTWARE]
  if (platform === 'win32') return [nvenc, qsv, amf, SOFTWARE]
  return [nvenc, SOFTWARE] // Linux: h264_nvenc once the bundled ffmpeg has it (the rest of its GPUs need libva, see CONTRIBUTING)
}
