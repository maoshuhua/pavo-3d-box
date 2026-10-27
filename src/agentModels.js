// Keys are provider model names. Legacy project modes remain readable without
// exposing the old product labels as separate choices.
export function selectedAgentModel(models, key) {
 return models.find(model=>model.key===key) || models.find(model=>model.legacyKeys?.includes(key)) || models[0];
}
