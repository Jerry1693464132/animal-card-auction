import capstone

EXE = r"C:\Users\ABC\Desktop\cursor\client\cocos-cli-smoke-test\build\windows\proj\Release\windows.exe"
TARGET = 0x375a30

with open(EXE, "rb") as f:
    data = f.read()

pe_off = int.from_bytes(data[0x3C:0x40], "little")
num_sections = int.from_bytes(data[pe_off+6:pe_off+8], "little")
opt_size = int.from_bytes(data[pe_off+20:pe_off+22], "little")
opt_off = pe_off + 24
sec_off = opt_off + opt_size

sections = []
for i in range(num_sections):
    o = sec_off + i * 40
    name = data[o:o+8].rstrip(b"\0").decode(errors="replace")
    vsize = int.from_bytes(data[o+8:o+12], "little")
    vaddr = int.from_bytes(data[o+12:o+16], "little")
    rawsize = int.from_bytes(data[o+16:o+20], "little")
    rawptr = int.from_bytes(data[o+20:o+24], "little")
    sections.append((name, vaddr, vsize, rawptr, rawsize))

text = [s for s in sections if s[0] == ".text"][0]
_, tvaddr, tvsize, trawptr, trawsize = text
code = data[trawptr:trawptr + trawsize]

md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
md.detail = True

callers = []
for insn in md.disasm(code, tvaddr):
    if insn.mnemonic in ("call", "jmp") and insn.operands:
        op = insn.operands[0]
        if op.type == capstone.x86.X86_OP_IMM:
            tgt = op.imm
            if tgt == TARGET:
                callers.append(insn.address)

print(f"callers of 0x{TARGET:x}: {len(callers)}")
for c in callers[:40]:
    print(f"  0x{c:08x}")
