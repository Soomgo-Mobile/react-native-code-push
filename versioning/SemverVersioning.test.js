import { SemverVersioning } from "./SemverVersioning";

describe('Semver Versioning Test', () => {
    const MOCK_INFOS = { downloadUrl: '', packageHash: '' }

    // When major version is released, it must be considered like below
    const FIRST_RELEASE_INFO = { enabled: true, mandatory: false, ...MOCK_INFOS };

    describe('findLatestRelease', () => {
        it('should throw error when there is no releases', () => {
            const RELEASED_BUNDLES = {}
            expect(() => new SemverVersioning(RELEASED_BUNDLES).findLatestRelease())
                .toThrow("There is no latest release.")
        })

        it('should return latest release', () => {
            const RELEASED_BUNDLES = {
                '1.0.0': { enabled: true, mandatory: false, downloadUrl: 'R1', packageHash: 'P1' },
                '1.1.0': { enabled: true, mandatory: false, downloadUrl: 'R2', packageHash: 'P2' },
                '1.1.1': { enabled: true, mandatory: true, downloadUrl: 'R3', packageHash: 'P3' },
            };

            expect(new SemverVersioning(RELEASED_BUNDLES).findLatestRelease()).toEqual([
                '1.1.1',
                { enabled: true, mandatory: true, downloadUrl: 'R3', packageHash: 'P3' }
            ])
        })

        it('should ignore not-enabled bundles and return latest release', () => {
            const RELEASED_BUNDLES_1 = {
                '1.0.0': { enabled: true, mandatory: false, downloadUrl: 'R1', packageHash: 'P1' },
                '1.1.0': { enabled: false, mandatory: false, downloadUrl: 'R2', packageHash: 'P2' },
            };

            const RELEASED_BUNDLES_2 = {
                '1.0.0': { enabled: true, mandatory: false, downloadUrl: 'R1', packageHash: 'P1' },
                '1.1.0': { enabled: false, mandatory: false, downloadUrl: 'R2', packageHash: 'P2' },
                '1.1.1': { enabled: true, mandatory: true, downloadUrl: 'R3', packageHash: 'P3' },
            };

            expect(new SemverVersioning(RELEASED_BUNDLES_1).findLatestRelease()).toEqual([
                '1.0.0',
                { enabled: true, mandatory: false, downloadUrl: 'R1', packageHash: 'P1' }
            ])

            expect(new SemverVersioning(RELEASED_BUNDLES_2).findLatestRelease()).toEqual([
                '1.1.1',
                { enabled: true, mandatory: true, downloadUrl: 'R3', packageHash: 'P3' }
            ])
        })
    })

    describe('checkIsMandatory', () => {
        describe('not-mandatory cases', () => {
            it('should consider not-mandatory when the first major version is released', () => {
                const RUNTIME_VERSION = '1.0.0';
                const RELEASED_BUNDLES = {
                    '1.0.0': FIRST_RELEASE_INFO,
                };

                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(false);
            });

            it('should consider not-mandatory when latest version is running', () => {
                const RUNTIME_VERSION = '1.1.1';
                const RELEASED_BUNDLES = {
                    '1.0.0': FIRST_RELEASE_INFO,
                    '1.1.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                    '1.1.1': { enabled: true, mandatory: true, ...MOCK_INFOS },
                };

                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(false);
            });

            it('should consider not-mandatory when only not-mandatory version is released', () => {
                const RUNTIME_VERSION = '1.0.0';
                const RELEASED_BUNDLES = {
                    '1.0.0': FIRST_RELEASE_INFO,
                    '1.1.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                };

                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(false);
            });

            it('should consider not-mandatory when only not-mandatory version is released after current runtime version', () => {
                const RUNTIME_VERSION = '1.0.1';
                const RELEASED_BUNDLES = {
                    '1.0.0': FIRST_RELEASE_INFO,
                    '1.0.1': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '1.1.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                };

                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(false);
            });
        })

        describe('mandatory cases', () => {
            it('should consider mandatory when mandatory release exists', () => {
                const RUNTIME_VERSION = '1.0.0';
                const RELEASED_BUNDLES = {
                    '1.0.0': FIRST_RELEASE_INFO,
                    '1.0.1': { enabled: true, mandatory: true, ...MOCK_INFOS },
                };

                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(true);
            });

            it("should consider mandatory if there's a mandatory release between the runtime version and the latest", () => {
                const RUNTIME_VERSION = '1.0.0'
                const RELEASED_BUNDLES = {
                    '1.0.0': FIRST_RELEASE_INFO,
                    '1.2.0': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '1.3.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                }

                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory(RUNTIME_VERSION)).toBe(true);
            })

            it('should consider mandatory when latest version < current runtime version (ROLLBACK)', () => {
                const RELEASED_BUNDLES = {
                    '1.1.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                };
                const currentVersion = '1.2.0'

                expect(new SemverVersioning(RELEASED_BUNDLES).shouldRollback(currentVersion)).toBe(true)
                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory(currentVersion)).toBe(true)
            })
        })

        describe('scenario test', () => {
            it('Major Release > Mandatory > Not-mandatory > Mandatory > Not-mandatory', () => {
                const RELEASED_BUNDLES = {
                    '1.0.0': FIRST_RELEASE_INFO,
                    '1.0.1': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '1.1.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                    '1.1.1': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '1.2.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                };

                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.0.0')).toBe(true);
                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.0.1')).toBe(true);
                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.1.0')).toBe(true);
                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.1.1')).toBe(false);
                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.2.0')).toBe(false);
            });

            it('When having not-enabled releases', () => {
                const RELEASED_BUNDLES = {
                    '1.0.0': FIRST_RELEASE_INFO,
                    '1.0.1': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '1.1.0': { enabled: false, mandatory: false, ...MOCK_INFOS },
                    '1.1.1': { enabled: true, mandatory: true, ...MOCK_INFOS },
                    '1.2.0': { enabled: false, mandatory: false, ...MOCK_INFOS },
                };

                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.0.0')).toBe(true);
                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.0.1')).toBe(true);
                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.1.0')).toBe(true);
                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.1.1')).toBe(false);
                expect(new SemverVersioning(RELEASED_BUNDLES).checkIsMandatory('1.2.0')).toBe(true);
            });
        })
    })

    describe('shouldRollbackToBinary', () => {
        it('should return false if it is not required to rollback', () => {
            const RELEASED_BUNDLES_1 = {
                '1.0.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
            };
            const RELEASED_BUNDLES_2 = {
                '1.0.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                '1.1.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                '1.2.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
            };
            expect(new SemverVersioning(RELEASED_BUNDLES_1).shouldRollbackToBinary('1.0.0')).toBe(false)
            expect(new SemverVersioning(RELEASED_BUNDLES_2).shouldRollbackToBinary('1.1.0')).toBe(false)
        })

        it('should return true if the destination version is the latest major version', () => {
            const RELEASED_BUNDLES_1 = {
                '1.0.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                '1.1.0': { enabled: false, mandatory: false, ...MOCK_INFOS },
                '1.2.0': { enabled: false, mandatory: false, ...MOCK_INFOS },
            };
            const RELEASED_BUNDLES_2 = {
                '1.2.0-rc.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
            };
            expect(new SemverVersioning(RELEASED_BUNDLES_1).shouldRollbackToBinary('1.2.0')).toBe(true)
            expect(new SemverVersioning(RELEASED_BUNDLES_2).shouldRollbackToBinary('1.2.0-rc.2')).toBe(true)
        })

        it('should return false if the destination version is not the latest major version', () => {
            const RELEASED_BUNDLES_1 = {
                '1.0.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                '1.1.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
            };
            const RELEASED_BUNDLES_2 = {
                '1.2.0-rc.0': { enabled: true, mandatory: false, ...MOCK_INFOS },
                '1.2.0-rc.1': { enabled: true, mandatory: false, ...MOCK_INFOS },
            };
            expect(new SemverVersioning(RELEASED_BUNDLES_1).shouldRollbackToBinary('1.2.0')).toBe(false)
            expect(new SemverVersioning(RELEASED_BUNDLES_2).shouldRollbackToBinary('1.2.0-rc.2')).toBe(false)
        })
    })
})
