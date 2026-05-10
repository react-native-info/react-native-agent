import { TurboModuleRegistry, type TurboModule } from 'react-native'

export interface Spec extends TurboModule {
  getRandomBase64(byteLength: number): string
}

export default TurboModuleRegistry.getEnforcing<Spec>('RNGetRandomValues');
