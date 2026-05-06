const input = "Com textos Estigma e os desafios da saúde mental no processo de formação educacional dos jovens brasileiros";
// eslint-disable-next-line no-control-regex
const regex = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const output = input.replace(regex, '');
console.log("Input: ", input);
console.log("Output:", output);
