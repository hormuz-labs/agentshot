// Optimistic concurrency prevents replacing routes changed since the read.
let input = ''
for await (const chunk of process.stdin) input += chunk
const ingress = JSON.parse(input)
const rules = (ingress.spec.rules || []).filter(rule => rule.host !== 'relay.manul.si')
rules.push({ host: 'relay.manul.si', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: 'relay', port: { number: 8091 } } } }] } })
const name = 'networking.gke.io/managed-certificates'
const certificates = new Set((ingress.metadata.annotations[name] || '').split(',').filter(Boolean))
certificates.add('manul-relay')
console.log(JSON.stringify([
  { op: 'test', path: '/metadata/resourceVersion', value: ingress.metadata.resourceVersion },
  { op: 'add', path: '/spec/rules', value: rules },
  { op: 'add', path: '/metadata/annotations/networking.gke.io~1managed-certificates', value: [...certificates].join(',') },
]))
