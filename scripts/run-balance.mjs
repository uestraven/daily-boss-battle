import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import {reference001} from '../dist/src/reference.js';
import {analyzeEncounter} from '../dist/src/balance.js';

const witness=JSON.parse(readFileSync(new URL('../fixtures/witness-v06.json',import.meta.url),'utf8'));
const options={beamWidth:Number(process.argv[2]??48),maxExpansions:Number(process.argv[3]??5000),maxHeroActions:24};
const report=analyzeEncounter(reference001,witness.playerActions,options);
console.log(`Encounter: ${report.encounterId} / content: ${report.contentVersion}`);
console.log(`Golden: ${report.golden.stars} stars, ${report.golden.heroActions} hero actions, tick ${report.golden.tick}`);
console.log(`Search: beam ${options.beamWidth}; max ${options.maxExpansions} expansions per probe`);
for(const p of report.probes){
  console.log(`${p.id.padEnd(24)} ${String(p.bestStars??'—').padStart(2)} stars  ${String(p.shortestWinningActions??'—').padStart(2)} actions  ${p.solutionsFound} stored witnesses  ${p.truncated?'bounded/truncated':'fully explored'}`);
}
console.log('Diagnostic policies:');
for(const p of report.baselinePolicies)console.log(`  ${p.policy}: ${p.result}, ${p.stars} stars`);
console.log('Review findings:');
for(const finding of report.findings)console.log(`  ${finding.severity.toUpperCase()} ${finding.code}: ${finding.detail}`);
for(const note of report.interpretation)console.log(`NOTE: ${note}`);
mkdirSync('reports',{recursive:true});
writeFileSync('reports/reference-001-balance-v03.json',JSON.stringify(report,null,2)+'\n');
console.log('Wrote reports/reference-001-balance-v03.json');
