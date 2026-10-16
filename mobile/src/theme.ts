// The desktop app's colours (src/renderer/src/styles.css): near-white by day, the Pallas cat's dark fur by night,
// amber of its eyes in both.
import { useColorScheme } from 'react-native'

const light = {
  bg: '#fbfbf9', surface: '#ffffff', raised: '#f0f0ee', line: '#e4e4e2', fg: '#141413', dim: '#52514f', faint: '#898782',
  amber: '#c06f12', amberSoft: '#c06f121a', onAmber: '#ffffff', ok: '#2d8653', bad: '#c2412f',
}
const dark: typeof light = {
  bg: '#0e0d0c', surface: '#1d1a17', raised: '#1d1a17', line: '#2c2723', fg: '#efe8df', dim: '#a39888', faint: '#6f665b',
  amber: '#f2a541', amberSoft: '#f2a54122', onAmber: '#1a1208', ok: '#7cc79a', bad: '#ef7a6a',
}

export type Theme = typeof light
export const useTheme = (): Theme => (useColorScheme() === 'dark' ? dark : light)
