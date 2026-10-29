import { ConfigurationManagerRequest } from '../../types/configurationManager';
import {
    addConfiguration, addPlatform, ConfigurationModel, removeConfiguration, removePlatform, renameConfiguration, renamePlatform, setMapping,
} from './model';

/** Applies a request to the model; throws a user-readable Error for invalid input. `projects` are the solution's project paths */
export function applyRequest(model: ConfigurationModel, request: ConfigurationManagerRequest, projects: readonly string[]): ConfigurationModel {
    switch (request.type) {
        case 'setMapping': return setMapping(model, request.project, request.configuration, request.platform, request.mapping);
        case 'addConfiguration': return addConfiguration(model, request.name, request.copyFrom);
        case 'renameConfiguration': return renameConfiguration(model, request.from, request.to, projects);
        case 'removeConfiguration': return removeConfiguration(model, request.name);
        case 'addPlatform': return addPlatform(model, request.name, request.copyFrom);
        case 'renamePlatform': return renamePlatform(model, request.from, request.to, projects);
        case 'removePlatform': return removePlatform(model, request.name);
        default: return model;
    }
}
