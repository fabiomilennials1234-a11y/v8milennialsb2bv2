// @vitest-environment node
/**
 * Telefone das LPs (public/lp/_shared/phone.js). O arquivo é script clássico, servido sem bundler; aqui ele roda
 * num contexto isolado, exatamente como o navegador o recebe. A máscara corta em 11 dígitos: número colado com
 * +55 ou com zero de operadora não pode virar outro número válido, porque o n8n aceitaria e o lead se perderia.
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Phone = { digits(raw: unknown): string; format(raw: unknown): string; isValid(raw: unknown): boolean };

const source = fs.readFileSync(path.resolve(__dirname, "../../public/lp/_shared/phone.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const phone = (context as { TorquePhone: Phone }).TorquePhone;

describe("normalização: o que o visitante cola vira DDD + número", () => {
  it.each([
    ["48984334050", "48984334050", "(48) 98433-4050"],
    ["(48) 98433-4050", "48984334050", "(48) 98433-4050"],
    ["+55 48 98433-4050", "48984334050", "(48) 98433-4050"],
    ["5548984334050", "48984334050", "(48) 98433-4050"],
    ["048984334050", "48984334050", "(48) 98433-4050"],
    ["0055 48 98433-4050", "48984334050", "(48) 98433-4050"],
    ["+55 (48) 3234-5678", "4832345678", "(48) 3234-5678"],
    ["4832345678", "4832345678", "(48) 3234-5678"],
    ["(55) 98765-4321", "55987654321", "(55) 98765-4321"],
    ["+55 55 98765-4321", "55987654321", "(55) 98765-4321"],
    ["5532345678", "5532345678", "(55) 3234-5678"],
  ])("%s → %s", (raw, digits, formatted) => {
    expect(phone.digits(raw)).toBe(digits);
    expect(phone.format(raw)).toBe(formatted);
    expect(phone.isValid(raw)).toBe(true);
  });
});

describe("validação: bloqueia o que o n8n perderia", () => {
  it.each([
    ["vazio", ""],
    ["nulo", null],
    ["só DDD", "48"],
    ["incompleto", "119876"],
    ["10 dígitos começando em 1", "4812345678"],
    ["10 dígitos começando em 0 depois do DDD", "4802345678"],
    ["11 dígitos sem o 9", "48834334050"],
    ["DDD com zero", "10987654321"],
    ["texto", "abc"],
  ])("%s é inválido", (_rotulo, raw) => {
    expect(phone.isValid(raw)).toBe(false);
  });
});

describe("digitação: a máscara reescreve o campo a cada tecla", () => {
  /** Simula o input: o valor mascarado volta para o campo e recebe o próximo dígito. */
  const typed = (keys: string) => [...keys].reduce((value, key) => phone.format(value + key), "");

  it.each([
    ["48984334050", "(48) 98433-4050"],
    ["4832345678", "(48) 3234-5678"],
    ["55987654321", "(55) 98765-4321"],
    ["5548984334050", "(48) 98433-4050"],
    ["048984334050", "(48) 98433-4050"],
  ])("%s termina em %s", (keys, final) => {
    expect(typed(keys)).toBe(final);
  });

  it("dígito além de 11 não muda um número já completo", () => {
    expect(typed("489843340501")).toBe("(48) 98433-4050");
  });
});
