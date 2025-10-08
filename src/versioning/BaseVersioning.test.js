import { BaseVersioning } from "./BaseVersioning"

describe('BaseVersioning', () => {
    describe('constructor', () => {
        it('should throw an error if it is directly instantiated', () => {
            expect(() => new BaseVersioning({})).toThrow("Abstract classes can't be instantiated.")
        })

        it('should throw an error if releaseHistory is not defined', () => {
            class TestVersioning extends BaseVersioning {}
            expect(() => new TestVersioning()).toThrow("param releaseHistory and sortingMethod is needed")
            expect(() => new TestVersioning({}, () => {})).not.toThrow("param releaseHistory and sortingMethod is needed")
        })
    })
})
