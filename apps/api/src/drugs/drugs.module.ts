import { Module } from "@nestjs/common";

import { DrugMatcher } from "./matcher.js";

/** The drug matcher, for the admin browser now and the prescription pipeline (Task 2.8) next. */
@Module({ providers: [DrugMatcher], exports: [DrugMatcher] })
export class DrugsModule {}
