import { IncrementalVersioning } from "./IncrementalVersioning"

describe('Incremental Versioning Test', () => {
    const MOCK_INFOS = { downloadUrl: '', packageHash: '' }

    // When major version is released, it must be considered like below
    const FIRST_RELEASE_INFO = { enabled: true, mandatory: false, ...MOCK_INFOS };

    describe('findLatestRelease', () => {
        it('should throw error when there is no releases', () => {
            const RELEASED_BUNDLES_1 = {}
            const RELEASED_BUNDLES_2 = {'1': { enabled: false, mandatory: false, downloadUrl: 'R1', packageHash: 'P1' }}
            expect(() => new IncrementalVersioning(RELEASED_BUNDLES_1).findLatestRelease())
                .toThrow("There is no latest release.")
            expect(() => new IncrementalVersioning(RELEASED_BUNDLES_2).findLatestRelease())
                .toThrow("There is no latest release.")
        })

        it('should return latest release', () => {
            const RELEASED_BUNDLES = {
                '1': { enabled: true, mandatory: false, downloadUrl: 'R1', packageHash: 'P1' },
                '2': { enabled: true, mandatory: false, downloadUrl: 'R2', packageHash: 'P2' },
                '3': { enabled: true, mandatory: true, downloadUrl: 'R3', packageHash: 'P3' },
            };

            expect(new IncrementalVersioning(RELEASED_BUNDLES).findLatestRelease()).toEqual([
                '3',
                { enabled: true, mandatory: true, downloadUrl: 'R3', packageHash: 'P3' }
            ])
        })

        it('should ignore not-enabled bundles and return latest release', () => {
            const RELEASED_BUNDLES_1 = {
                '1': { enabled: true, mandatory: false, downloadUrl: 'R1', packageHash: 'P1' },
                '2': { enabled: false, mandatory: false, downloadUrl: 'R2', packageHash: 'P2' },
            };

            const RELEASED_BUNDLES_2 = {
                '1': { enabled: true, mandatory: false, downloadUrl: 'R1', packageHash: 'P1' },
                '2': { enabled: false, mandatory: false, downloadUrl: 'R2', packageHash: 'P2' },
                '3': { enabled: true, mandatory: true, downloadUrl: 'R3', packageHash: 'P3' },
            };

            expect(new IncrementalVersioning(RELEASED_BUNDLES_1).findLatestRelease()).toEqual([
                '1',
                { enabled: true, mandatory: false, downloadUrl: 'R1', packageHash: 'P1' }
            ])

            expect(new IncrementalVersioning(RELEASED_BUNDLES_2).findLatestRelease()).toEqual([
                '3',
                { enabled: true, mandatory: true, downloadUrl: 'R3', packageHash: 'P3' }
            ])
        })
    })

    describe('checkIsMandatory', () => {
        describe('not-mandatory cases', () => {
            it('should consider not-mandatory when the first major version is released', () => {
                const RUNTIME_VERSION = '1';
                const RELEASED_BUNDLES = {
                    '1': FIRST_RELEASE_INFO,
                };
        
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(false);
            });
        
            it('should consider not-mandatory when latest version is running', () => {
                const RUNTIME_VERSION = '3';
                const RELEASED_BUNDLES = {
                    '1': FIRST_RELEASE_INFO,
                    '2': { enabled: true, mandatory: false, ...MOCK_INFOS },
                    '3': { enabled: true, mandatory: true, ...MOCK_INFOS },
                };
        
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(false);
            });

            it('should consider not-mandatory when only not-mandatory version is released', () => {
                const RUNTIME_VERSION = '1';
                const RELEASED_BUNDLES = {
                    '1': FIRST_RELEASE_INFO,
                    '2': { enabled: true, mandatory: false, ...MOCK_INFOS },
                };
        
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(false);
            });

            it('should consider not-mandatory when only not-mandatory version is released after current runtime version', () => {
                const RUNTIME_VERSION = '2';
                const RELEASED_BUNDLES = {
                    '1': FIRST_RELEASE_INFO,
                    '2': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '3': { enabled: true, mandatory: false, ...MOCK_INFOS },
                };
        
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(false);
            });
        })

        describe('mandatory cases', () => {
            it('should consider mandatory when mandatory release exists', () => {
                const RUNTIME_VERSION = '1';
                const RELEASED_BUNDLES = {
                    '1': FIRST_RELEASE_INFO,
                    '2': { enabled: true, mandatory: true, ...MOCK_INFOS },
                };
        
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(true);
            });

            it("should consider mandatory if there's a mandatory release between the runtime version and the latest", () => {
                const RUNTIME_VERSION = '1'
                const RELEASED_BUNDLES = {
                    '1': FIRST_RELEASE_INFO,
                    '2': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '3': { enabled: true, mandatory: false, ...MOCK_INFOS },
                }

                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(true);
            })

            it('should consider mandatory when latest version < current runtime version (ROLLBACK)', () => {
                const RELEASED_BUNDLES = {
                    '1': FIRST_RELEASE_INFO,
                };
                const currentVersion = '2'
    
                expect(new IncrementalVersioning(RELEASED_BUNDLES).shouldRollback(currentVersion)).toBe(true)
            })
        })

        describe('scenario test', () => {
            it('Major Release > Mandatory > Not-mandatory > Mandatory > Not-mandatory', () => {
                const RELEASED_BUNDLES = {
                    '1': FIRST_RELEASE_INFO,
                    '2': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '3': { enabled: true, mandatory: false, ...MOCK_INFOS },
                    '4': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '5': { enabled: true, mandatory: false, ...MOCK_INFOS },
                };

                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('1')).toBe(true);
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('2')).toBe(true);
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('3')).toBe(true);
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('4')).toBe(false);
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('5')).toBe(false);
            });

            it('When having not-enabled releases', () => {
                const RELEASED_BUNDLES = {
                    '1': FIRST_RELEASE_INFO,
                    '2': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '3': { enabled: false, mandatory: false, ...MOCK_INFOS },
                    '4': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '5': { enabled: false, mandatory: false, ...MOCK_INFOS },
                };

                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('1')).toBe(true);
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('2')).toBe(true);
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('3')).toBe(true);
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('4')).toBe(false);
                expect(new IncrementalVersioning(RELEASED_BUNDLES).checkIsMandatory('5')).toBe(true);
            });
        })
    })

    describe('shouldRollbackToBinary', () => {
        it('should return true when destination version is the first major version', () => {
            const RELEASED_BUNDLES = {
                '1': FIRST_RELEASE_INFO,
                '2': { enabled: false, mandatory: true, ...MOCK_INFOS },
            };

            expect(new IncrementalVersioning(RELEASED_BUNDLES).shouldRollbackToBinary('2')).toBe(true)
        })

        it('should return false when runtime version is the same as destination version', () => {
            const RELEASED_BUNDLES = {
                '1': FIRST_RELEASE_INFO,
                '2': { enabled: false, mandatory: true, ...MOCK_INFOS },
            };

            expect(new IncrementalVersioning(RELEASED_BUNDLES).shouldRollbackToBinary('1')).toBe(false)
        })
    })
})
