const input = "Com textos Estigma e os desafios da saúde mental no processo de formação educacional dos jovens brasileiros";
const regex = new RegExp(String.raw`[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]`, 'g');
const output = input.replace(regex, '');
console.log("Input: ", input);
console.log("Output:", output);
