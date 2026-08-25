import assert from 'node:assert/strict';
import { applyGraphDelta, parseGraphDelta } from '../src/sidepanel/utils/graphDelta.js';

const oneLine = `RGΔ +node baroque-main synthesis title="17世纪绘画的在场感转向" checkpoint="多个分支共同指向更强的观看在场性。" keywords="Baroque|presence|Caravaggio" status="active" +node baroque-branches comparison title="17世纪欧洲绘画的两条主干" checkpoint="天主教宫廷欧洲与荷兰市民市场分化。" keywords="Catholic Europe|Dutch Golden Age|Rubens|Rembrandt|Vermeer" status="active" +edge baroque-branches baroque-main deepens focus: baroque-main`;

const parsed = parseGraphDelta(oneLine);
assert.deepEqual(parsed.errors, []);
assert.equal(parsed.operations.length, 4);
assert.equal(parsed.operations[0].nodeType, 'synthesis');
assert.equal(parsed.operations[0].title, '17世纪绘画的在场感转向');
assert.deepEqual(parsed.operations[0].keywords, ['Baroque', 'presence', 'Caravaggio']);
assert.equal(parsed.operations[1].title, '17世纪欧洲绘画的两条主干');
assert.deepEqual(parsed.operations[1].keywords, ['Catholic Europe', 'Dutch Golden Age', 'Rubens', 'Rembrandt', 'Vermeer']);
assert.equal(parsed.operations[2].op, 'addEdge');
assert.equal(parsed.operations[2].from, 'baroque-branches');
assert.equal(parsed.operations[2].to, 'baroque-main');
assert.equal(parsed.operations[2].relation, 'deepens');
assert.equal(parsed.operations[3].op, 'focus');

const applied = applyGraphDelta(
  { nodes: [], edges: [], focusNodeId: null },
  parsed,
  {
    messageId: 'assistant-message-1',
    role: 'assistant',
    preview: 'baroque answer',
    tail: 'baroque answer tail',
    textLength: 100,
    messageIndex: 4,
    roleIndex: 2
  }
);

assert.equal(applied.nodes.length, 2);
assert.equal(applied.edges.length, 1);
assert.equal(applied.nodes.find((node) => node.data.semanticId === 'baroque-main').data.type, 'synthesis');
assert.equal(applied.nodes.find((node) => node.data.semanticId === 'baroque-branches').data.title, '17世纪欧洲绘画的两条主干');
assert.equal(applied.edges[0].data.relation, 'deepens');
// Canonical deepens direction must remain specific child -> broader parent.
assert.equal(applied.edges[0].source, 'rg_baroque-branches');
assert.equal(applied.edges[0].target, 'rg_baroque-main');
assert.equal(applied.focusNodeId, 'rg_baroque-main');

const judgment = parseGraphDelta('RGΔ +node buy-now judgment title="当前不买" checkpoint="估值与风险收益比不足。" keywords="valuation|risk" status="resolved"');
assert.deepEqual(judgment.errors, []);
assert.equal(judgment.operations[0].nodeType, 'judgment');

const manualGraph = {
  nodes: [
    {
      id: 'research_1234567890abcdef',
      type: 'researchNode',
      position: { x: 0, y: 0 },
      data: { type: 'analysis', title: '旧手工节点' }
    }
  ],
  edges: [],
  focusNodeId: null
};
const manualAlias = 'M_567890abcdef';
const manualDelta = parseGraphDelta(`RGΔ +node new-topic analysis title="新节点" checkpoint="test" keywords="a|b" +edge new-topic ${manualAlias} informs`);
const manualApplied = applyGraphDelta(manualGraph, manualDelta, { messageId: 'assistant-message-2', role: 'assistant' });
assert.equal(manualApplied.nodes.length, 2);
assert.equal(manualApplied.edges.length, 1);
assert.equal(manualApplied.edges[0].target, 'research_1234567890abcdef');

const oneLineUpdate = parseGraphDelta('RGΔ ~node baroque-main checkpoint="updated" status="resolved" focus: baroque-main');
assert.deepEqual(oneLineUpdate.errors, []);
assert.equal(oneLineUpdate.operations.length, 2);
assert.equal(oneLineUpdate.operations[0].op, 'updateNode');
assert.equal(oneLineUpdate.operations[1].op, 'focus');

console.log('✓ graphDelta regression tests passed');
