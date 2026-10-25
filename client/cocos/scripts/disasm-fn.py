import capstone

EXE = r"C:\Users\ABC\Desktop\cursor\client\cocos-cli-smoke-test\build\windows\proj\Release\windows.exe"
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

# exception directory (RUNTIME_FUNCTION) from data dir 3
opt_off2 = pe_off + 24
num_dd = int.from_bytes(data[opt_off2+108:opt_off2+112], "little")
dd_off = opt_off2 + 112
exc_rva = int.from_bytes(data[dd_off+3*8:dd_off+3*8+4], "little")
exc_size = int.from_bytes(data[dd_off+3*8+4:dd_off+3*8+8], "little")
print(f"exception dir rva=0x{exc_rva:x} size=0x{exc_size:x} entries={exc_size//12}")

def off_to_file(rva):
    for name, vaddr, vsize, rawptr, rawsize in sections:
        if vaddr <= rva < vaddr + max(vsize, rawsize):
            return rawptr + (rva - vaddr)
    return None

ef = off_to_file(exc_rva)
TARGET = 0x375a30

entry = None
for i in range(exc_size // 12):
    o = ef + i * 12
    start = int.from_bytes(data[o:o+4], "little")
    end = int.from_bytes(data[o+4:o+8], "little")
    if start <= TARGET < end:
        entry = (start, end)
        break

print("containing function:", entry)
if not entry:
    raise SystemExit

start, end = entry
print(f"function RVA 0x{start:x} .. 0x{end:x}  (size {end-start} bytes)")

fo = off_to_file(start)
code = data[fo:fo + (end - start)]

md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
md.detail = True
for insn in md.disasm(code, start):
    print(f"0x{insn.address:08x}  {insn.mnemonic:<10} {insn.op_str}")
