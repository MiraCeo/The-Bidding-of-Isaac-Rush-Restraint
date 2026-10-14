/** Research only: generic lossless JSON reference packing, NOT a production save format. */
type Primitive = null | boolean | string | number;
type Atom = Primitive | { r: number };
type Node = { a: Atom[] } | { o: [string, Atom][] };
export interface ResearchReferenceDocument {
  format: 'survival-research-references-1';
  root: Atom;
  nodes: Node[];
}
export function packResearchReferences(
  input: unknown,
): ResearchReferenceDocument {
  const nodes: Node[] = [],
    index = new Map<string, number>();
  function atom(value: unknown): Atom {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'boolean'
    )
      return value;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error('Non-finite research value');
      return value;
    }
    if (!value || typeof value !== 'object')
      throw new Error('Research codec accepts JSON values only');
    const node: Node = Array.isArray(value)
      ? { a: value.map(atom) }
      : { o: Object.entries(value).map(([key, value]) => [key, atom(value)]) };
    const key = JSON.stringify(node);
    let id = index.get(key);
    if (id === undefined) {
      id = nodes.length;
      index.set(key, id);
      nodes.push(node);
    }
    return { r: id };
  }
  return { format: 'survival-research-references-1', root: atom(input), nodes };
}
export function unpackResearchReferences(
  doc: ResearchReferenceDocument,
): unknown {
  if (
    doc.format !== 'survival-research-references-1' ||
    !Array.isArray(doc.nodes) ||
    doc.nodes.length > 200000
  )
    throw new Error('Invalid research reference document');
  const decoded: unknown[] = [];
  function value(atom: Atom, limit: number): unknown {
    if (atom === null || typeof atom === 'string' || typeof atom === 'boolean')
      return atom;
    if (typeof atom === 'number' && Number.isFinite(atom)) return atom;
    if (
      typeof atom !== 'object' ||
      !atom ||
      Object.keys(atom).join() !== 'r' ||
      !Number.isInteger(atom.r) ||
      atom.r < 0 ||
      atom.r >= limit
    )
      throw new Error('Invalid or forward research reference');
    return decoded[atom.r];
  }
  for (const [i, node] of doc.nodes.entries()) {
    if (
      Object.keys(node).join() === 'a' &&
      'a' in node &&
      Array.isArray(node.a)
    )
      decoded.push(node.a.map((a) => value(a, i)));
    else if (
      Object.keys(node).join() === 'o' &&
      'o' in node &&
      Array.isArray(node.o)
    ) {
      const keys = new Set<string>();
      const entries = node.o.map((pair) => {
        if (
          !Array.isArray(pair) ||
          pair.length !== 2 ||
          typeof pair[0] !== 'string' ||
          keys.has(pair[0]) ||
          ['__proto__', 'constructor', 'prototype'].includes(pair[0])
        )
          throw new Error('Invalid research object');
        keys.add(pair[0]);
        return [pair[0], value(pair[1], i)] as const;
      });
      decoded.push(Object.fromEntries(entries));
    } else throw new Error('Invalid research node');
  }
  // Do not expose dictionary aliasing to consumers. Preserve serialized facts, not runtime references.
  return JSON.parse(JSON.stringify(value(doc.root, decoded.length)));
}
