// A project is named after the video it starts from. Phones and cameras name files by number (Android's photo picker
// hands over its media id, 5959.mp4; cameras VID_20261030_142233, IMG_4412, PXL_…, GOPR0042), which says nothing: those
// get the day instead.
const MACHINE = /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|(?:vid|img|pxl|mvimg|dsc[fn]?|gopr|gh\d\d|dji|mov|video|image|screen[-_ ]?recording|screenshot|record(?:ing)?|trim)[-_ .]*\d[\d_.\-]*(?:[-_ ]?\w{0,12})?)$/i

/** Whether [name] is a file name a device made up rather than a person. */
export const machineMade = (name: string) => MACHINE.test(name.trim())

/** The title for a project from the file [name] (without its extension), made [when]. */
export function titleFromFile(name: string, when = Date.now()): string {
  if (name.trim() && !machineMade(name)) return name.trim()
  return `Video from ${new Date(when).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
}
