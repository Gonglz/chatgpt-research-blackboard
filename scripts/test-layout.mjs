import assert from 'node:assert/strict';
import {
  RESEARCH_NODE_WIDTH,
  deriveSemanticBackbone,
  layoutResearchGraph,
  researchStructuralSignature
} from '../src/sidepanel/utils/researchLayout.js';

function node(id, x = 0, y = 0) {
  return {
    id,
    type: 'researchNode',
    position: { x, y },
    data: { type: 'analysis', title: id }
  };
}

function edge(id, source, target, relation = 'deepens') {
  return { id, source, target, data: { relation }, label: relation };
}

const nodes = [node('root'), node('a'), node('b'), node('a1')];
const edges = [
  edge('e-a-root', 'a', 'root'),
  edge('e-b-root', 'b', 'root'),
  edge('e-a1-a', 'a1', 'a'),
  edge('e-lateral', 'a', 'b', 'compares')
];

const backbone = deriveSemanticBackbone(nodes, edges);
assert.equal(backbone.parentByNodeId.a, 'root');
assert.equal(backbone.parentByNodeId.b, 'root');
assert.equal(backbone.parentByNodeId.a1, 'a');
assert.equal(backbone.depthByNodeId.root, 0);
assert.equal(backbone.depthByNodeId.a, 1);
assert.equal(backbone.depthByNodeId.b, 1);
assert.equal(backbone.depthByNodeId.a1, 2);

// Cross-links must not change the structural signature.
const signatureWithCrossLink = researchStructuralSignature(nodes, edges);
const signatureWithoutCrossLink = researchStructuralSignature(
  nodes,
  edges.filter((candidate) => candidate.id !== 'e-lateral')
);
assert.equal(signatureWithCrossLink, signatureWithoutCrossLink);

// A previously valid parent wins when a node has multiple deepens parents.
const multiParentEdges = [
  ...edges,
  edge('e-a1-b', 'a1', 'b')
];
const preferredBackbone = deriveSemanticBackbone(nodes, multiParentEdges, { a1: 'b' });
assert.equal(preferredBackbone.parentByNodeId.a1, 'b');

// Cycles are excluded from the derived backbone instead of mutating canonical edges.
const cyclicNodes = [node('x'), node('y')];
const cyclicEdges = [
  edge('e-x-y', 'x', 'y'),
  edge('e-y-x', 'y', 'x')
];
const cyclicBackbone = deriveSemanticBackbone(cyclicNodes, cyclicEdges);
assert.equal(Object.keys(cyclicBackbone.parentByNodeId).length, 1);
assert.equal(cyclicBackbone.rootIds.length, 1);

// Layout invariants: broader parents are above children and siblings cannot overlap.
const overlapping = [
  node('root', 0, 0),
  node('a', 0, 0),
  node('b', 0, 0),
  node('a1', 0, 0)
];
const laidOut = await layoutResearchGraph(overlapping, edges, {});
const byId = new Map(laidOut.nodes.map((item) => [item.id, item]));

assert.ok(byId.get('a').position.y > byId.get('root').position.y, 'child a must be below root');
assert.ok(byId.get('b').position.y > byId.get('root').position.y, 'child b must be below root');
assert.ok(byId.get('a1').position.y > byId.get('a').position.y, 'grandchild must be below child');

const siblingDistance = Math.abs(byId.get('a').position.x - byId.get('b').position.x);
assert.ok(
  siblingDistance >= RESEARCH_NODE_WIDTH,
  `same-rank siblings must not overlap; got horizontal distance ${siblingDistance}`
);

assert.equal(laidOut.layoutState.backboneParentByNodeId.a, 'root');
assert.equal(laidOut.layoutState.backboneParentByNodeId.b, 'root');

console.log('✓ research layout regression tests passed');
